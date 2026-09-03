import { describe, expect, it } from 'vitest';
import {
  MAX_LENGTH_RATIO,
  mentions,
  shuffle,
  tokenize,
  validateQuestion,
  type CandidateOption,
  type CandidateQuestion,
} from './question-validate';

/**
 * Four balanced options about four different technologies, none of which names one.
 * Every test below is a single deliberate deviation from this.
 */
const OPTIONS: CandidateOption[] = [
  {
    text: 'routes requests to backend services by host and path',
    isCorrect: true,
    sourceSkillId: null,
  },
  {
    text: 'stores rows in a write-ahead log before committing',
    isCorrect: false,
    sourceSkillId: 2,
  },
  {
    text: 'schedules containers across a cluster of worker nodes',
    isCorrect: false,
    sourceSkillId: 3,
  },
  {
    text: 'caches compiled templates in memory between requests',
    isCorrect: false,
    sourceSkillId: 4,
  },
];

function candidate(overrides: Partial<CandidateQuestion> = {}): CandidateQuestion {
  return {
    stem: 'Which of the following is true of nginx?',
    explanation: 'The correct option describes how requests reach backend services.',
    options: OPTIONS,
    involvedNames: ['nginx', 'PostgreSQL', 'Kubernetes'],
    ...overrides,
  };
}

describe('validateQuestion — a question that is fit to show', () => {
  it('accepts a balanced four-option question', () => {
    expect(validateQuestion(candidate())).toEqual([]);
  });

  it('reports every violation, not just the first', () => {
    const violations = validateQuestion(
      candidate({ stem: 'Why?', explanation: 'Because.', options: OPTIONS.slice(0, 3) }),
    );
    expect(violations).toContain('stem-too-short');
    expect(violations).toContain('explanation-too-short');
    expect(violations).toContain('option-count:3');
  });
});

describe('validateQuestion — the structural invariants', () => {
  it('rejects a set with no correct option', () => {
    const options = OPTIONS.map((option) => ({ ...option, isCorrect: false }));
    expect(validateQuestion(candidate({ options }))).toContain('correct-count:0');
  });

  it('rejects a set with two correct options', () => {
    const options = OPTIONS.map((option, i) => ({ ...option, isCorrect: i < 2 }));
    expect(validateQuestion(candidate({ options }))).toContain('correct-count:2');
  });

  it('rejects the same claim appearing twice', () => {
    const first = OPTIONS[0] as CandidateOption;
    const options = [...OPTIONS.slice(0, 3), { ...first, isCorrect: false, sourceSkillId: 4 }];
    expect(validateQuestion(candidate({ options }))).toContain('duplicate-option');
  });

  it('treats punctuation and casing as the same option', () => {
    const first = OPTIONS[0] as CandidateOption;
    const options = [
      ...OPTIONS.slice(0, 3),
      { text: `  ${first.text.toUpperCase()}.  `, isCorrect: false, sourceSkillId: 4 },
    ];
    expect(validateQuestion(candidate({ options }))).toContain('duplicate-option');
  });
});

describe('validateQuestion — the tells that make a question free', () => {
  it('rejects an option that names the skill being asked about', () => {
    const options = [
      {
        text: 'nginx routes requests to backend services by path',
        isCorrect: true,
        sourceSkillId: null,
      },
      ...OPTIONS.slice(1),
    ];
    expect(validateQuestion(candidate({ options }))).toContain('option-names-skill:nginx');
  });

  it('rejects a distractor that names its own technology', () => {
    const options = [
      OPTIONS[0] as CandidateOption,
      {
        text: 'PostgreSQL stores rows in a write-ahead log first',
        isCorrect: false,
        sourceSkillId: 2,
      },
      ...OPTIONS.slice(2),
    ];
    expect(validateQuestion(candidate({ options }))).toContain('option-names-skill:PostgreSQL');
  });

  it('rejects "all of the above"', () => {
    const options = [
      ...OPTIONS.slice(0, 3),
      { text: 'All of the above are correct', isCorrect: false, sourceSkillId: 4 },
    ];
    expect(validateQuestion(candidate({ options }))).toContain('banned-phrase');
  });

  it('rejects a set where the correct option is conspicuously the longest', () => {
    const options = [
      {
        text: 'routes incoming requests to a chosen backend service using host headers, path prefixes, and weighting rules configured up front',
        isCorrect: true,
        sourceSkillId: null,
      },
      { text: 'stores rows in a write-ahead log first', isCorrect: false, sourceSkillId: 2 },
      { text: 'schedules containers across worker nodes', isCorrect: false, sourceSkillId: 3 },
      { text: 'caches compiled templates in memory', isCorrect: false, sourceSkillId: 4 },
    ];
    expect(validateQuestion(candidate({ options }))).toContain('length-imbalance');
  });

  it('accepts a set that is uneven but within the ratio', () => {
    const shortest = (OPTIONS[0] as CandidateOption).text.length;
    const options = [
      OPTIONS[0] as CandidateOption,
      {
        text: 'x'.repeat(Math.floor(shortest * (MAX_LENGTH_RATIO - 0.2))),
        isCorrect: false,
        sourceSkillId: 2,
      },
      ...OPTIONS.slice(2),
    ];
    expect(validateQuestion(candidate({ options }))).not.toContain('length-imbalance');
  });

  it('rejects an option too short to be a claim', () => {
    const options = [
      ...OPTIONS.slice(0, 3),
      { text: 'is fast', isCorrect: false, sourceSkillId: 4 },
    ];
    expect(validateQuestion(candidate({ options }))).toContain('option-too-short');
  });
});

describe('mentions — whole words, because the short names are the dangerous ones', () => {
  it('finds a name on its own', () => {
    expect(mentions('serves static files quickly', 'files')).toBe(true);
  });

  it('does not find a name inside a longer word', () => {
    // The reason this is not a substring test: "Go" is a real skill name.
    expect(mentions('going to the backend', 'Go')).toBe(false);
    expect(mentions('written in Go for speed', 'Go')).toBe(true);
  });

  it('finds a multi-word name only when the words are adjacent', () => {
    expect(mentions('built on Spring Boot conventions', 'Spring Boot')).toBe(true);
    expect(mentions('Spring is used to boot the app', 'Spring Boot')).toBe(false);
  });

  it('keeps the symbols that are part of a name', () => {
    expect(tokenize('written in C++ and C#')).toEqual(['written', 'in', 'c++', 'and', 'c#']);
    expect(mentions('compiled from C++ sources', 'C++')).toBe(true);
    expect(mentions('compiled from C sources', 'C++')).toBe(false);
  });

  it('ignores case and surrounding punctuation', () => {
    expect(mentions('uses REDIS, mostly.', 'Redis')).toBe(true);
  });
});

describe('shuffle', () => {
  it('keeps every element', () => {
    const items = [1, 2, 3, 4, 5];
    expect([...shuffle(items, () => 0.5)].sort()).toEqual(items);
  });

  it('does not mutate its input', () => {
    const items = [1, 2, 3, 4];
    shuffle(items, () => 0.99);
    expect(items).toEqual([1, 2, 3, 4]);
  });

  it('actually moves the first element off the front', () => {
    // Options are assembled correct-first. Without this the answer is always option A.
    const moved = shuffle(['correct', 'b', 'c', 'd'], () => 0);
    expect(moved[0]).not.toBe('correct');
  });
});
