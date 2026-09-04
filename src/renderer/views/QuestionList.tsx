import {
  EXPLANATION_REASONS,
  QUESTION_REASONS,
  type FeedbackReason,
  type FeedbackTarget,
  type Question,
} from '@shared/domain';
import { CHANNELS } from '@shared/ipc';
import { useCallback, useEffect, useState } from 'react';

interface Props {
  readonly skillId: number;
  /** How many *other* researched skills exist — what actually gates asking about this one. */
  readonly otherSkillCount: number;
}

/**
 * Why the flag is a menu and not a thumbs-down.
 *
 * "Bad question" cannot be acted on — two correct options is a missing validator rule,
 * implausible options are an assembly problem, and a wandering explanation is a prompt
 * problem. Asking for the reason is what turns one moment of annoyance into a fixable
 * signal ([ADR-0005](../../../docs/architecture/adr/0005-feedback-as-eval-data.md)).
 */
const REASON_LABELS: Readonly<Record<FeedbackReason, string>> = {
  ambiguous: 'More than one option is correct',
  'implausible-distractors': 'The wrong options are obviously wrong',
  'wrong-answer': 'The answer marked correct is wrong',
  'too-easy': 'Too easy to be worth asking',
  'off-topic': 'Not about this skill',
  'explanation-wrong': 'The explanation is wrong',
  'explanation-unclear': 'The explanation does not explain',
};

const TARGET_OF: Readonly<Record<FeedbackReason, FeedbackTarget>> = Object.fromEntries([
  ...QUESTION_REASONS.map((reason) => [reason, 'question' as FeedbackTarget]),
  ...EXPLANATION_REASONS.map((reason) => [reason, 'explanation' as FeedbackTarget]),
]) as Record<FeedbackReason, FeedbackTarget>;

/** A question is one correct claim plus three drawn from three other skills. */
const MIN_OTHER_SKILLS = 3;

export function QuestionList({ skillId, otherSkillCount }: Props): React.JSX.Element {
  const [questions, setQuestions] = useState<readonly Question[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [answered, setAnswered] = useState<Readonly<Record<number, number>>>({});
  const [flagging, setFlagging] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (cancelled?: () => boolean) => {
      const result = await window.api.invoke(CHANNELS.questionsForSkill, skillId);
      if (cancelled?.()) return;
      setLoaded(true);
      if (result.ok) setQuestions(result.value);
      else setError(result.error.message);
    },
    [skillId],
  );

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the main process is the external system this subscribes to; setState runs after the await, and the guard covers unmount
    void load(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function flag(questionId: number, reason: FeedbackReason): Promise<void> {
    setFlagging(null);
    const result = await window.api.invoke(CHANNELS.questionsFlag, {
      questionId,
      target: TARGET_OF[reason],
      reason,
    });
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    // A flagged question leaves rotation immediately: telling the user it is bad and then
    // showing it again tomorrow reads as the app ignoring them.
    await load();
  }

  if (!loaded) return <p className="muted">Loading questions…</p>;

  if (questions.length === 0) {
    // Two earlier versions of this were both wrong. The first promised questions "once a
    // neighbouring skill has been researched", which is not the rule. The second named the
    // rule but told the user to "add 3 more skills in the same area" — advice nobody can
    // act on, because a CV is not a thing you can grow on request. Wrong answers now come
    // from any researched skill, so what it asks for is something the user can actually do.
    const needed = MIN_OTHER_SKILLS - otherSkillCount;
    return (
      <p className="muted">
        No questions yet.{' '}
        {needed > 0 ? (
          <>
            Every wrong answer is a true fact about a <em>different</em> skill of yours, so this one
            needs {String(MIN_OTHER_SKILLS)} other researched skills to draw from — there{' '}
            {otherSkillCount === 1 ? 'is' : 'are'} {String(otherSkillCount)}. Add {String(needed)}{' '}
            more, in any area; related ones make sharper questions.
          </>
        ) : (
          <>They are being written in the background. This can take a minute or two.</>
        )}
      </p>
    );
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      {questions.map((question) => {
        const chosen = answered[question.id];
        const revealed = chosen !== undefined;

        return (
          <article key={question.id} style={{ marginBottom: 20 }}>
            <p style={{ fontWeight: 600, marginBottom: 8 }}>{question.stem}</p>

            <ul className="list" style={{ gap: 4 }}>
              {question.options.map((option) => {
                const picked = chosen === option.id;
                const mark = !revealed ? '' : option.isCorrect ? ' ✓' : picked ? ' ✗' : '';
                return (
                  <li key={option.id} style={{ padding: 0 }}>
                    <button
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        opacity: revealed && !option.isCorrect && !picked ? 0.6 : 1,
                      }}
                      disabled={revealed}
                      onClick={() => setAnswered({ ...answered, [question.id]: option.id })}
                    >
                      {option.text}
                      {mark}
                      {/* The lesson: a wrong option is a true statement about a
                          neighbour, so naming it afterwards is the point. */}
                      {revealed && !option.isCorrect && (
                        <span className="muted" style={{ fontSize: 12 }}>
                          {' '}
                          — {option.rationale}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>

            {revealed && (
              <>
                <p className="card-body" style={{ marginTop: 8 }}>
                  {question.explanation}
                </p>
                <p className="muted" style={{ fontSize: 12 }}>
                  {question.model} · {question.promptVersion} ·{' '}
                  <button
                    onClick={() => setFlagging(flagging === question.id ? null : question.id)}
                    style={{
                      padding: '0 4px',
                      border: 'none',
                      background: 'none',
                      color: 'inherit',
                      textDecoration: 'underline',
                    }}
                  >
                    Report a problem
                  </button>
                </p>

                {flagging === question.id && (
                  <ul className="list" style={{ gap: 4 }}>
                    {[...QUESTION_REASONS, ...EXPLANATION_REASONS].map((reason) => (
                      <li key={reason} style={{ padding: 0 }}>
                        <button
                          style={{ width: '100%', textAlign: 'left' }}
                          onClick={() => void flag(question.id, reason)}
                        >
                          {REASON_LABELS[reason]}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}
