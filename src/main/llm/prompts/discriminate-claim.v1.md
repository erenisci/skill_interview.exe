Decide whether a statement is false of a specific technology.

The statement below was written about a _different_ technology. It is being considered as a wrong answer in
a multiple-choice question about {{SKILL}}. That only works if it is genuinely false of {{SKILL}}.

This matters because the two technologies are neighbours — they were paired precisely because they are
similar, and similar tools share properties. "Terminates TLS and forwards requests to backend servers" is
written about one reverse proxy and true of every other one. Used as a wrong answer it produces a question
with two correct options, which is the single worst defect a question can have: the reader answers
correctly and is told they are wrong.

So answer conservatively. The question to settle is not "was this written about {{SKILL}}" — it was not.
It is "could a knowledgeable person read this and reasonably call it true of {{SKILL}}?"

- If it is clearly false of {{SKILL}} — it describes a model, guarantee, or behaviour {{SKILL}} does not
  have — answer `false`.
- If it is true of {{SKILL}}, or arguably true, or generic enough to be true of most things in the
  category, answer `true`.
- If the material does not settle it, answer `true`. Discarding a usable distractor costs one option.
  Keeping an ambiguous one costs the reader's trust.

The material below is what is known about {{SKILL}}. Judge against it and against nothing else.

TECHNOLOGY: {{SKILL}}

MATERIAL ABOUT {{SKILL}}:
{{MATERIAL}}

STATEMENT (written about a different technology):
{{CLAIM}}

Return `couldBeTrue` — `true` if the statement could reasonably be called true of {{SKILL}}, `false` if it
is clearly false of it — and a one-sentence `reason`.
