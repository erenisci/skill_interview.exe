import {
  EXPLANATION_REASONS,
  QUESTION_REASONS,
  type FeedbackReason,
  type FeedbackTarget,
} from '@shared/domain';
import { CHANNELS, type Channel, type IpcRequest, type IpcResponse } from '@shared/ipc';
import { appError, err, ok } from '@shared/result';
import { BrowserWindow, dialog, ipcMain } from 'electron';
import { writeFile } from 'node:fs/promises';
import { applyLlmSettings, type AppContext } from '../context';
import { currentVersion } from '../db/migrate';
import { exportFavoritesMarkdown, hydrateFavorites } from '../export/favorites';
import { RelationsRepository } from '../db/repositories/relations';
import { getTodaysSet, recordAnswer } from '../scheduler/daily-set-service';
import { checkLlmReadiness } from '../startup/readiness';
import { log } from '../util/logger';
import { validateSetting } from '../util/settings-validation';
import { looksLikeAList, normalizeSkillName, toSlug } from '../util/slug';

type Handler<C extends Channel> = (
  request: IpcRequest<C>,
  ctx: AppContext,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

/**
 * Errors cross IPC as values, never as thrown exceptions: the renderer receives a
 * discriminated union it has to handle, so an unhandled failure is a type error rather
 * than a blank window (docs/operations/error-handling.md).
 */
function handle<C extends Channel>(channel: C, ctx: AppContext, fn: Handler<C>): void {
  ipcMain.handle(channel, async (_event, request: IpcRequest<C>) => {
    try {
      return await fn(request, ctx);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      log.error('ipc', 'handler threw', { channel, detail });
      return err(appError('internal', 'handler-threw', detail));
    }
  });
}

/** Which reasons belong to which target — the pairing SQLite's CHECK cannot express. */
const EXPECTED_REASONS: Readonly<Record<FeedbackTarget, readonly FeedbackReason[]>> = {
  question: QUESTION_REASONS,
  explanation: EXPLANATION_REASONS,
};

export function registerIpc(ctx: AppContext, appVersion: string): void {
  handle(CHANNELS.systemStatus, ctx, async () =>
    ok({
      appVersion,
      schemaVersion: currentVersion(ctx.db),
      llm: await checkLlmReadiness(ctx),
    }),
  );

  handle(CHANNELS.skillsList, ctx, () => ok(ctx.skills.list()));

  handle(CHANNELS.skillsAdd, ctx, (request) => {
    const name = normalizeSkillName(request.name);
    if (name.length === 0) {
      return err(appError('validation', 'empty-name', 'a skill needs a name'));
    }

    if (looksLikeAList(name)) {
      return err(
        appError('validation', 'looks-like-a-list', 'add one skill at a time, without commas'),
      );
    }

    const slug = toSlug(name);
    if (slug.length === 0) {
      return err(appError('validation', 'unusable-name', `"${name}" has no usable characters`));
    }

    // FR-02: offer the existing skill rather than creating a second one.
    const existing = ctx.skills.findBySlug(slug);
    if (existing) {
      return err(
        appError('validation', 'duplicate-skill', `"${existing.name}" is already tracked`),
      );
    }

    const now = new Date().toISOString();
    const skill = ctx.skills.insert({
      name,
      slug,
      contentLang: request.contentLang,
      createdAt: now,
    });
    // Research is background work from the moment the skill exists: the user never waits
    // on the model, and a crash before it runs leaves the job on disk.
    ctx.jobs.enqueue('research', { skillId: skill.id }, now);
    // Log the identifier, never the name — the skill list is the user's CV.
    log.info('ipc', 'skill added', { skillId: skill.id });
    return ok(skill);
  });

  handle(CHANNELS.skillsRelated, ctx, (skillId) => {
    const related = [];
    for (const relation of ctx.relations.listFor(skillId)) {
      const otherId = RelationsRepository.otherSide(relation, skillId);
      const skill = ctx.skills.findById(otherId);
      // A relation whose other end is gone is stale, not an error worth surfacing.
      if (skill) related.push({ skill, kind: relation.kind, strength: relation.strength });
    }
    return ok(related);
  });

  handle(CHANNELS.cardsForSkill, ctx, (skillId) =>
    ok(
      ctx.cards.listBySkill(skillId).map((card) => ({
        card,
        sources: ctx.cards.sourcesFor(card.id),
      })),
    ),
  );

  handle(CHANNELS.skillsRemove, ctx, (id) => {
    if (!ctx.skills.remove(id)) {
      return err(appError('validation', 'unknown-skill', `no skill with id ${id}`));
    }
    log.info('ipc', 'skill removed', { skillId: id });
    return ok(undefined);
  });

  handle(CHANNELS.questionsForSkill, ctx, (skillId) => ok(ctx.questions.listBySkill(skillId)));

  handle(CHANNELS.questionsFlag, ctx, (request) => {
    // The renderer sends a union member, but IPC input is untrusted regardless of what
    // the type says — a value outside the enum would otherwise reach a CHECK constraint
    // as a thrown exception instead of a handled result.
    if (!EXPECTED_REASONS[request.target]?.includes(request.reason)) {
      return err(
        appError(
          'validation',
          'bad-reason',
          `"${request.reason}" is not a reason for a ${request.target} flag`,
        ),
      );
    }

    const recorded = ctx.questions.flag({
      questionId: request.questionId,
      target: request.target,
      reason: request.reason,
      note: request.note?.trim() || null,
      createdAt: new Date().toISOString(),
    });
    if (!recorded) {
      return err(
        appError('validation', 'unknown-question', `no question with id ${request.questionId}`),
      );
    }

    // The reason is the signal, so it is logged; the note is the user's own words and is
    // not (docs/operations/logging.md).
    log.info('ipc', 'question flagged', {
      questionId: request.questionId,
      target: request.target,
      reason: request.reason,
    });
    return ok(undefined);
  });

  handle(CHANNELS.dailyGet, ctx, () => getTodaysSet(ctx));

  handle(CHANNELS.dailyAnswer, ctx, (request) => {
    // Untrusted input regardless of what the type claims — an out-of-range value must
    // reach a handled result, not a downstream throw.
    if (request.itemType !== 'card' && request.itemType !== 'question') {
      return err(
        appError('validation', 'bad-item-type', `"${request.itemType}" is not an item type`),
      );
    }
    if (request.rating !== 'again' && request.rating !== 'good') {
      return err(appError('validation', 'bad-rating', `"${request.rating}" is not a rating`));
    }
    return recordAnswer(ctx, request.itemType, request.itemId, request.rating);
  });

  handle(CHANNELS.favoritesList, ctx, () => ok(hydrateFavorites(ctx)));

  handle(CHANNELS.favoritesToggle, ctx, (request) => {
    if (request.itemType !== 'card' && request.itemType !== 'question') {
      return err(
        appError('validation', 'bad-item-type', `"${request.itemType}" is not an item type`),
      );
    }

    if (ctx.favorites.remove(request.itemType, request.itemId)) {
      log.info('ipc', 'favourite removed', { itemType: request.itemType });
      return ok(false);
    }
    ctx.favorites.add(request.itemType, request.itemId, new Date().toISOString());
    log.info('ipc', 'favourite added', { itemType: request.itemType });
    return ok(true);
  });

  handle(CHANNELS.favoritesNote, ctx, (request) => {
    if (!ctx.favorites.setNote(request.itemType, request.itemId, request.note)) {
      return err(
        appError('validation', 'not-favourited', 'a note needs the item to be favourited first'),
      );
    }
    // The note is the user's own writing, so it is never logged (docs/operations/logging.md).
    return ok(undefined);
  });

  handle(CHANNELS.favoritesExport, ctx, async () => {
    const markdown = exportFavoritesMarkdown(ctx);
    if (!markdown.ok) return markdown;

    const window = BrowserWindow.getFocusedWindow();
    const dated = new Date().toISOString().slice(0, 10);
    const chosen = await (window
      ? dialog.showSaveDialog(window, {
          defaultPath: `skill-interview-favourites-${dated}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        })
      : dialog.showSaveDialog({
          defaultPath: `skill-interview-favourites-${dated}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        }));

    // Dismissing the dialog is a decision, not a failure — the renderer shows nothing.
    if (chosen.canceled || !chosen.filePath) return ok({ path: null });

    await writeFile(chosen.filePath, markdown.value, 'utf8');
    // The path is chosen by the user and can contain their username, which the logging
    // rules forbid — only that an export happened is recorded.
    log.info('ipc', 'favourites exported');
    return ok({ path: chosen.filePath });
  });

  handle(CHANNELS.settingsGet, ctx, (key) => ok(ctx.settings.get(key)));

  handle(CHANNELS.settingsSet, ctx, async ({ key, value }) => {
    // Validated at the boundary: the settings screen writes the keys the scheduler and the
    // reminder read, and a value they cannot parse fails silently rather than loudly —
    // a malformed reminder time simply never fires again.
    const checked = validateSetting(key, value);
    if (!checked.ok) return checked;
    ctx.settings.set(key, checked.value);
    // These two decide which adapter `buildLlmAdapter` produces; every other setting is
    // read fresh by whatever uses it next; the model choice is baked into a live object,
    // wired at startup, that nothing else knows how to rebuild but did anyway.
    if (key === 'ollama_model' || key === 'ollama_url') {
      await applyLlmSettings(ctx);
      log.info('ipc', 'llm adapter reloaded', { key });
    }
    return ok(undefined);
  });
}
