import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Eval sets: fixed inputs, so two runs are comparable.
 *
 * Sources are **frozen copies under `evals/sources/`, never live fetches**. A live fetch
 * would make a run non-reproducible and would confuse a search regression with a prompt
 * regression — the two need completely different fixes, and a number that cannot tell them
 * apart is worse than no number ([eval-harness.md](../../docs/llm/eval-harness.md)).
 *
 * A case references its source by filename rather than embedding the text, so the frozen
 * material stays readable and diffable instead of living on one enormous JSON line.
 */

const ROOT = join(import.meta.dirname, '..');

export interface DisambiguationCase {
  readonly id: string;
  readonly skill: string;
  readonly candidates: readonly {
    readonly title: string;
    readonly lead: string;
    /**
     * What the deterministic name gate matches against, which is **not** the title. A
     * GitHub result carries the repository name (`zustand`) here and the full name
     * (`pmndrs/zustand`) as its title; Wikipedia carries the article title for both.
     * Conflating the two makes the gate reject correct candidates, which the first eval
     * run scored as a model failure until the fixture was corrected.
     */
    readonly identity?: string;
  }[];
  /** Index of the candidate that is the named technology, or `null` when none is. */
  readonly expected: number | null;
  readonly note: string;
}

export interface GroundingCase {
  readonly id: string;
  readonly skill: string;
  readonly sourceFile: string;
}

export interface RefusalCase {
  readonly id: string;
  readonly skill: string;
  readonly sourceFile: string;
  readonly note: string;
}

export interface InjectionCase {
  readonly id: string;
  readonly skill: string;
  readonly sourceFile: string;
  /** Strings that appearing in the output would prove the embedded instruction was obeyed. */
  readonly forbidden: readonly string[];
  readonly note: string;
}

export interface LanguageCase {
  readonly id: string;
  readonly skill: string;
  readonly sourceFile: string;
  /** Technical terms that must survive verbatim rather than being paraphrased away. */
  readonly keepTerms: readonly string[];
}

export interface PlausibilityCase {
  readonly id: string;
  readonly skillA: string;
  readonly skillB: string;
  readonly sourceFileA: string;
  readonly sourceFileB: string;
}

/** Parses JSONL, ignoring blank lines and `#` comments so a set can explain itself. */
export function loadSet<T>(name: string): readonly T[] {
  const path = join(ROOT, 'sets', `${name}.jsonl`);
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch (cause) {
        throw new Error(`${name}.jsonl line ${String(index + 1)} is not valid JSON`, { cause });
      }
    });
}

/** Reads a frozen source document. Throws loudly — a missing source invalidates the run. */
export function loadSource(fileName: string): string {
  return readFileSync(join(ROOT, 'sources', fileName), 'utf8').trim();
}
