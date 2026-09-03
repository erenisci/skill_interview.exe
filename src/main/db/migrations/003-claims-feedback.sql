-- Claims and question feedback (M-4).
--
-- A *claim* is one atomic factual statement about a skill, written from that skill's card.
-- It is the unit questions are assembled from: a question about nginx is one true claim
-- about nginx plus three claims belonging to its neighbours. Claims are stored rather than
-- generated per question because a claim written for Traefik is exactly what makes an
-- nginx question hard, and regenerating it for every neighbour would pay for it twice.
--
-- A claim never names its own technology — naming it would hand the answer to the reader.
-- That rule cannot be expressed here; the validator enforces it.
CREATE TABLE claims (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id       INTEGER NOT NULL REFERENCES skills (id) ON DELETE CASCADE,
  card_id        INTEGER NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  text           TEXT    NOT NULL,
  model          TEXT    NOT NULL,
  prompt_version TEXT    NOT NULL,
  created_at     TEXT    NOT NULL
);

CREATE INDEX idx_claims_skill ON claims (skill_id);

-- Why a reason code and not a thumbs-down.
--
-- "This question is bad" is not a usable signal: the fixes for its causes have nothing in
-- common. Two correct options is a missing validator rule, implausible options are a
-- distractor-assembly problem, and a wandering explanation is a prompt problem. Without
-- the reason, every flag would be read as "change the prompt", which is the one response
-- that cannot be measured (docs/architecture/adr/0005-feedback-as-eval-data.md).
--
-- `target` separates the question from the explanation on purpose. A sound question with a
-- sloppy explanation is a different defect from a broken question, and collapsing the two
-- would blur both.
CREATE TABLE question_feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES questions (id) ON DELETE CASCADE,
  target      TEXT    NOT NULL CHECK (target IN ('question', 'explanation')),
  reason      TEXT    NOT NULL CHECK (reason IN (
                        'ambiguous',
                        'implausible-distractors',
                        'wrong-answer',
                        'too-easy',
                        'off-topic',
                        'explanation-wrong',
                        'explanation-unclear'
                      )),
  note        TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX idx_question_feedback_q ON question_feedback (question_id);

-- Questions are read by skill and only while active, so the daily set never pays for rows
-- the user has already rejected.
CREATE INDEX idx_questions_skill ON questions (skill_id, status);
