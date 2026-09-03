-- Claims become pairwise (M-4, after the gate was measured).
--
-- Migration 003 stored one set of claims per skill, written with no neighbour in view, and
-- a separate model call then judged whether each borrowed claim was false of the target.
-- Measured against a real model, that gate left 1 of 28 claims standing: it rejects only
-- when the material explicitly contradicts a claim, and material about one technology is
-- silent about nearly everything another one does
-- (docs/architecture/adr/0006-pairwise-claims.md).
--
-- A claim is now written knowing both technologies at once — true of `skill_id`, false of
-- `contrast_skill_id` — which is the judgement the comparison card already shows the model
-- makes well. The pair is the unit, so the column is not nullable in practice even though
-- SQLite cannot add a NOT NULL column to an existing table without a default.
ALTER TABLE claims ADD COLUMN contrast_skill_id INTEGER REFERENCES skills (id) ON DELETE CASCADE;

-- Claims written under the old rule carry no contrast, so nothing can be said about what
-- they are false of. They are not repairable, only regenerable.
DELETE FROM claims;

-- The distractor pool for one question is exactly one pair, read in one direction.
CREATE INDEX idx_claims_pair ON claims (contrast_skill_id, skill_id);
