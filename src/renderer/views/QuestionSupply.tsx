import { CHANNELS, type QuestionAvailability } from '@shared/ipc';
import { useEffect, useState } from 'react';

interface Props {
  readonly skillId: number;
}

/**
 * One line on a skill: how many questions it has, and if none, why.
 *
 * The questions themselves are **not** here any more. They belong to a day rather than to a
 * skill — they change as the schedule moves, and a reader meets them in Today, where the
 * flag sits beside them. What stays behind is the thing a person managing a skill needs to
 * know: whether it can be asked about at all.
 *
 * Three earlier versions of the empty state were wrong, each in the same way: they guessed
 * instead of asking. The first promised questions "once a neighbouring skill has been
 * researched" — not the rule. The second said to add three more skills in the same area,
 * which nobody can act on. The third said they were "being written in the background", and
 * on a real database that was false for four skills out of six.
 */
export function QuestionSupply({ skillId }: Props): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [supply, setSupply] = useState<QuestionAvailability | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [questions, status] = await Promise.all([
        window.api.invoke(CHANNELS.questionsForSkill, skillId),
        window.api.invoke(CHANNELS.questionsStatus, skillId),
      ]);
      if (cancelled) return;
      if (questions.ok) setCount(questions.value.length);
      if (status.ok) setSupply(status.value);
    })();
    return () => {
      cancelled = true;
    };
  }, [skillId]);

  if (count === null) return <p className="muted">Counting questions…</p>;

  if (count > 0) {
    return (
      <p className="muted">
        {String(count)} question{count === 1 ? '' : 's'} written. They appear in{' '}
        <strong>Today</strong> as the schedule brings them up.
      </p>
    );
  }

  if (supply?.working === true) {
    return <p className="muted">Writing questions now — this takes a minute or two.</p>;
  }

  if (supply && supply.distractors < supply.needed) {
    return (
      <p className="muted">
        No questions yet. Each wrong answer is a true fact about a <em>different</em> skill of
        yours, and there {supply.distractors === 1 ? 'is' : 'are'} {String(supply.distractors)} of
        the {String(supply.needed)} needed. Adding a related skill is what produces more.
      </p>
    );
  }

  return <p className="muted">No questions yet.</p>;
}
