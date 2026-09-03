import { ipcMain } from 'electron';
import { CHANNELS, type Channel, type IpcRequest, type IpcResponse } from '@shared/ipc';
import { appError, err, ok } from '@shared/result';
import type { AppContext } from '../context';
import { currentVersion } from '../db/migrate';
import { checkLlmReadiness } from '../startup/readiness';
import { normalizeSkillName, toSlug } from '../util/slug';
import { log } from '../util/logger';

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

  handle(CHANNELS.settingsGet, ctx, (key) => ok(ctx.settings.get(key)));

  handle(CHANNELS.settingsSet, ctx, ({ key, value }) => {
    ctx.settings.set(key, value);
    return ok(undefined);
  });
}
