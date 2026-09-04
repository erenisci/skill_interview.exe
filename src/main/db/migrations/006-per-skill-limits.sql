-- Per-skill daily limits.
--
-- The global `daily_cards` / `daily_questions` settings say how big a day is. They say
-- nothing about where the day's material comes from, and assembly took whatever the pool
-- offered first — which, in id order, means the earliest-added skills fill the whole set
-- and the newest ones are never seen. A user with four skills and four cards a day should
-- get one from each, not two from the first two.
--
-- These columns are the per-skill override on top of that: a cap on how much this skill may
-- contribute in one day. NULL is the normal state and means "no cap of its own" — the
-- global count and the even spread decide. 0 is a real value and means "not today", which
-- is how a user parks a skill without deleting it and losing its review history.

ALTER TABLE skills ADD COLUMN daily_cards INTEGER;
ALTER TABLE skills ADD COLUMN daily_questions INTEGER;
