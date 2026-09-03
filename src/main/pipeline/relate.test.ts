import { describe, expect, it } from 'vitest';
import {
  COMPARISON_THRESHOLD,
  earnsComparison,
  relate,
  relationsFor,
  tagSimilarity,
  type Classified,
} from './relate';

const nginx: Classified = {
  id: 1,
  category: 'web-server',
  tags: ['reverse-proxy', 'load-balancer', 'http'],
};
const traefik: Classified = {
  id: 2,
  category: 'web-server',
  tags: ['reverse-proxy', 'load-balancer', 'ingress'],
};
const postgres: Classified = {
  id: 3,
  category: 'database',
  tags: ['sql', 'relational', 'acid'],
};
const apache: Classified = {
  id: 4,
  category: 'web-server',
  tags: ['static-files', 'cgi', 'modules'],
};
const kubernetes: Classified = {
  id: 5,
  category: 'platform',
  tags: ['ingress', 'load-balancer', 'containers'],
};

describe('tagSimilarity', () => {
  it('is 1 for identical tag sets and 0 for disjoint ones', () => {
    expect(tagSimilarity(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(tagSimilarity(['a'], ['b'])).toBe(0);
  });

  it('measures overlap against everything either side is tagged with', () => {
    // two shared out of four distinct
    expect(tagSimilarity(nginx.tags, traefik.tags)).toBeCloseTo(0.5);
  });

  it('is 0 when either side has no tags, rather than dividing by zero', () => {
    expect(tagSimilarity([], ['a'])).toBe(0);
    expect(tagSimilarity(['a'], [])).toBe(0);
  });
});

describe('relate — the roadmap exit criteria', () => {
  it('links nginx and Traefik, and strongly enough to earn a comparison', () => {
    const relation = relate(nginx, traefik);
    expect(relation).not.toBeNull();
    if (!relation) return;
    expect(relation.kind).toBe('same-category');
    expect(relation.strength).toBeCloseTo(0.75);
    expect(earnsComparison(relation)).toBe(true);
  });

  it('does not link nginx and PostgreSQL', () => {
    expect(relate(nginx, postgres)).toBeNull();
  });
});

describe('relate — the rest of the rules', () => {
  it('links same-category skills even with no shared tags, but weakly', () => {
    const relation = relate(nginx, apache);
    expect(relation).not.toBeNull();
    if (!relation) return;
    expect(relation.kind).toBe('same-category');
    expect(relation.strength).toBeCloseTo(0.5);
    // Related enough to be neighbours, not enough to spend a card comparing.
    expect(earnsComparison(relation)).toBe(false);
  });

  it('links across categories when the tag overlap is real', () => {
    const relation = relate(traefik, kubernetes);
    expect(relation?.kind).toBe('tag-overlap');
    expect(relation?.strength).toBeGreaterThan(0);
  });

  it('does not link across categories on a single incidental tag', () => {
    const a: Classified = { id: 10, category: 'language', tags: ['jvm', 'static-typing', 'oop'] };
    const b: Classified = { id: 11, category: 'build-tool', tags: ['jvm', 'gradle', 'kotlin-dsl'] };
    // One shared tag out of five is coincidence, not comparability.
    expect(relate(a, b)).toBeNull();
  });

  it('stores the pair in one direction regardless of argument order', () => {
    const forward = relate(nginx, traefik);
    const backward = relate(traefik, nginx);
    expect(forward?.skillAId).toBe(1);
    expect(forward?.skillBId).toBe(2);
    expect(backward).toEqual(forward);
  });

  it('never relates a skill to itself', () => {
    expect(relate(nginx, { ...nginx })).toBeNull();
  });

  it('ignores a skill that has not been classified yet', () => {
    const unclassified: Classified = { id: 9, category: null, tags: [] };
    expect(relate(nginx, unclassified)).toBeNull();
  });
});

describe('relationsFor', () => {
  it('returns only the skills that actually relate', () => {
    const relations = relationsFor(nginx, [traefik, postgres, apache, kubernetes]);
    // Traefik and Apache share nginx's category. PostgreSQL shares nothing. Kubernetes
    // shares exactly one tag (load-balancer) across a category boundary, which is
    // coincidence — Traefik reaches it on two, nginx does not.
    expect(relations.map((r) => r.skillBId).sort()).toEqual([2, 4]);
  });

  it('returns nothing when there is nothing to relate to', () => {
    expect(relationsFor(nginx, [])).toEqual([]);
  });
});

describe('COMPARISON_THRESHOLD', () => {
  it('sits above a bare category match, so a shared category alone is not a card', () => {
    expect(COMPARISON_THRESHOLD).toBeGreaterThan(0.5);
  });
});
