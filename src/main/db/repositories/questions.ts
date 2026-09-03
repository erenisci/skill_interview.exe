import type {
  Claim,
  ContentLanguage,
  FeedbackReason,
  FeedbackTarget,
  Question,
  QuestionOption,
  QuestionStatus,
} from '@shared/domain';
import type { Db } from '../index';

interface QuestionRow {
  id: number;
  skill_id: number;
  card_id: number;
  stem: string;
  explanation: string;
  difficulty: string | null;
  content_lang: string;
  model: string;
  prompt_version: string;
  status: string;
}

interface OptionRow {
  id: number;
  question_id: number;
  text: string;
  rationale: string;
  is_correct: number;
  source_skill_id: number | null;
}

interface ClaimRow {
  id: number;
  skill_id: number;
  card_id: number;
  text: string;
  model: string;
  prompt_version: string;
  created_at: string;
}

function toOption(row: OptionRow): QuestionOption {
  return {
    id: row.id,
    questionId: row.question_id,
    text: row.text,
    rationale: row.rationale,
    isCorrect: row.is_correct === 1,
    sourceSkillId: row.source_skill_id,
  };
}

function toClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    skillId: row.skill_id,
    cardId: row.card_id,
    text: row.text,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: row.created_at,
  };
}

export interface NewClaim {
  readonly skillId: number;
  readonly cardId: number;
  readonly text: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdAt: string;
}

export interface NewOption {
  readonly text: string;
  readonly rationale: string;
  readonly isCorrect: boolean;
  /** Which sibling this distractor came from. Null only for the correct option. */
  readonly sourceSkillId: number | null;
}

export interface NewQuestion {
  readonly skillId: number;
  readonly cardId: number;
  readonly stem: string;
  readonly explanation: string;
  readonly difficulty?: string | null;
  readonly contentLang: ContentLanguage;
  readonly model: string;
  readonly promptVersion: string;
}

export const OPTION_COUNT = 4;

export class QuestionsRepository {
  constructor(private readonly db: Db) {}

  /**
   * Writes a question **and** its options in one transaction.
   *
   * As with cards and their sources, there is no way to insert one without the other. The
   * schema cannot express "exactly four options, exactly one correct", so this refuses to
   * make the broken state reachable: a half-written question is never a row anyone reads
   * ([database-design.md](../../../../docs/architecture/database-design.md)).
   */
  insertWithOptions(question: NewQuestion, options: readonly NewOption[]): Question {
    if (options.length !== OPTION_COUNT) {
      throw new Error(`a question needs exactly ${OPTION_COUNT} options, got ${options.length}`);
    }
    if (options.filter((o) => o.isCorrect).length !== 1) {
      throw new Error('a question needs exactly one correct option');
    }

    const write = this.db.transaction((): number => {
      const questionId = Number(
        this.db
          .prepare(
            `INSERT INTO questions
               (skill_id, card_id, stem, explanation, difficulty, content_lang, model, prompt_version, status)
             VALUES (@skillId, @cardId, @stem, @explanation, @difficulty, @contentLang, @model, @promptVersion, 'active')`,
          )
          .run({ ...question, difficulty: question.difficulty ?? null }).lastInsertRowid,
      );

      const insertOption = this.db.prepare(
        `INSERT INTO options (question_id, text, rationale, is_correct, source_skill_id)
         VALUES (@questionId, @text, @rationale, @isCorrect, @sourceSkillId)`,
      );
      for (const option of options) {
        insertOption.run({
          questionId,
          text: option.text,
          rationale: option.rationale,
          isCorrect: option.isCorrect ? 1 : 0,
          sourceSkillId: option.sourceSkillId,
        });
      }
      return questionId;
    });

    const created = this.findById(write());
    if (!created) throw new Error('question insert did not produce a row');
    return created;
  }

  findById(id: number): Question | null {
    const row = this.db.prepare('SELECT * FROM questions WHERE id = ?').get(id) as
      QuestionRow | undefined;
    return row ? this.hydrate(row) : null;
  }

  /** Active only by default: a flagged question has left rotation and should stay out. */
  listBySkill(skillId: number, status: QuestionStatus = 'active'): readonly Question[] {
    const rows = this.db
      .prepare('SELECT * FROM questions WHERE skill_id = ? AND status = ? ORDER BY id ASC')
      .all(skillId, status) as QuestionRow[];
    return rows.map((row) => this.hydrate(row));
  }

  countBySkill(skillId: number, status: QuestionStatus = 'active'): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM questions WHERE skill_id = ? AND status = ?')
      .get(skillId, status) as { n: number };
    return row.n;
  }

  setStatus(id: number, status: QuestionStatus): boolean {
    return (
      this.db.prepare('UPDATE questions SET status = ? WHERE id = ?').run(status, id).changes > 0
    );
  }

  /**
   * Records a flag and takes the question out of rotation in one transaction.
   *
   * The two belong together: a flag the user can still be shown the next day reads as the
   * app ignoring them, and a suppressed question with no recorded reason is a lost signal
   * ([ADR-0005](../../../../docs/architecture/adr/0005-feedback-as-eval-data.md)).
   */
  flag(input: {
    questionId: number;
    target: FeedbackTarget;
    reason: FeedbackReason;
    note: string | null;
    createdAt: string;
  }): boolean {
    const write = this.db.transaction((): boolean => {
      const exists = this.db
        .prepare('SELECT 1 AS present FROM questions WHERE id = ?')
        .get(input.questionId) as { present: number } | undefined;
      if (!exists) return false;

      this.db
        .prepare(
          `INSERT INTO question_feedback (question_id, target, reason, note, created_at)
           VALUES (@questionId, @target, @reason, @note, @createdAt)`,
        )
        .run(input);

      // A flagged explanation still leaves a usable question, so only a flag on the
      // question itself suppresses it.
      if (input.target === 'question') {
        this.db
          .prepare("UPDATE questions SET status = 'flagged' WHERE id = ?")
          .run(input.questionId);
      }
      return true;
    });
    return write();
  }

  /**
   * Flag counts grouped by reason and prompt version.
   *
   * This is the shape the eval harness reads: "v2 is flagged three times as often as v1"
   * is only sayable because every question carries the prompt version that produced it.
   */
  feedbackCounts(): readonly {
    promptVersion: string;
    reason: FeedbackReason;
    count: number;
  }[] {
    const rows = this.db
      .prepare(
        `SELECT q.prompt_version AS promptVersion, f.reason AS reason, COUNT(*) AS count
         FROM question_feedback f
         JOIN questions q ON q.id = f.question_id
         GROUP BY q.prompt_version, f.reason
         ORDER BY count DESC`,
      )
      .all() as { promptVersion: string; reason: string; count: number }[];
    return rows.map((row) => ({
      promptVersion: row.promptVersion,
      reason: row.reason as FeedbackReason,
      count: row.count,
    }));
  }

  /**
   * The correct-option text of every question already written for this skill.
   *
   * Keyed by text rather than by claim id on purpose. Regenerating a skill's claims gives
   * the same statements new ids, and an id-based guard would then let the same question be
   * asked a second time. Flagged questions are included: a question the user rejected must
   * not come back tomorrow because the job happened to run again.
   */
  askedClaimTexts(skillId: number): readonly string[] {
    const rows = this.db
      .prepare(
        `SELECT o.text AS text FROM options o
         JOIN questions q ON q.id = o.question_id
         WHERE q.skill_id = ? AND o.is_correct = 1`,
      )
      .all(skillId) as { text: string }[];
    return rows.map((row) => row.text);
  }

  /** Replaces a skill's claims: a regenerated card invalidates the ones drawn from it. */
  replaceClaims(skillId: number, claims: readonly NewClaim[]): void {
    const write = this.db.transaction(() => {
      this.db.prepare('DELETE FROM claims WHERE skill_id = ?').run(skillId);
      const insert = this.db.prepare(
        `INSERT INTO claims (skill_id, card_id, text, model, prompt_version, created_at)
         VALUES (@skillId, @cardId, @text, @model, @promptVersion, @createdAt)`,
      );
      for (const claim of claims) insert.run(claim);
    });
    write();
  }

  claimsForSkill(skillId: number): readonly Claim[] {
    const rows = this.db
      .prepare('SELECT * FROM claims WHERE skill_id = ? ORDER BY id ASC')
      .all(skillId) as ClaimRow[];
    return rows.map(toClaim);
  }

  /** Claims belonging to the given skills — the distractor pool for one question. */
  claimsForSkills(skillIds: readonly number[]): readonly Claim[] {
    if (skillIds.length === 0) return [];
    const placeholders = skillIds.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM claims WHERE skill_id IN (${placeholders}) ORDER BY id ASC`)
      .all(...skillIds) as ClaimRow[];
    return rows.map(toClaim);
  }

  private hydrate(row: QuestionRow): Question {
    const options = this.db
      .prepare('SELECT * FROM options WHERE question_id = ? ORDER BY id ASC')
      .all(row.id) as OptionRow[];
    return {
      id: row.id,
      skillId: row.skill_id,
      cardId: row.card_id,
      stem: row.stem,
      explanation: row.explanation,
      difficulty: row.difficulty,
      contentLang: row.content_lang as ContentLanguage,
      model: row.model,
      promptVersion: row.prompt_version,
      status: row.status as QuestionStatus,
      options: options.map(toOption),
    };
  }
}
