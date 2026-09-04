import {
  EXPLANATION_REASONS,
  QUESTION_REASONS,
  type FeedbackReason,
  type FeedbackTarget,
} from '@shared/domain';
import { useState } from 'react';

/**
 * Why the flag is a menu and not a thumbs-down.
 *
 * "Bad question" cannot be acted on — two correct options is a missing validator rule,
 * implausible options are an assembly problem, and a wandering explanation is a prompt
 * problem. Asking for the reason is what turns one moment of annoyance into a fixable
 * signal ([ADR-0005](../../../docs/architecture/adr/0005-feedback-as-eval-data.md)).
 *
 * It lives beside the question in **Today**, which is where a reader actually meets one. It
 * used to sit in the Skills tab, where a question had to be gone looking for.
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

/** Which half of the question a reason is about — they route to different fixes. */
const TARGET_OF: Readonly<Record<FeedbackReason, FeedbackTarget>> = Object.fromEntries([
  ...QUESTION_REASONS.map((reason) => [reason, 'question' as FeedbackTarget]),
  ...EXPLANATION_REASONS.map((reason) => [reason, 'explanation' as FeedbackTarget]),
]) as Record<FeedbackReason, FeedbackTarget>;

interface Props {
  readonly onFlag: (reason: FeedbackReason, target: FeedbackTarget) => void;
}

export function FlagMenu({ onFlag }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button className="flag" onClick={() => setOpen(true)}>
        Something is wrong with this
      </button>
    );
  }

  return (
    <div className="flag-menu">
      <p className="muted">What is wrong with it?</p>
      <ul className="list">
        {[...QUESTION_REASONS, ...EXPLANATION_REASONS].map((reason) => (
          <li key={reason} style={{ padding: 0 }}>
            <button
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => {
                setOpen(false);
                onFlag(reason, TARGET_OF[reason]);
              }}
            >
              {REASON_LABELS[reason]}
            </button>
          </li>
        ))}
      </ul>
      <button onClick={() => setOpen(false)}>Never mind</button>
    </div>
  );
}
