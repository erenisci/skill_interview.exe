You are writing interview questions about {{SKILL}}, from the material below.

Write each one the way an interviewer would: ask how something works, then offer four answers of
which exactly one is right.

The three wrong answers are the craft, and the question coming first is what makes them
possible. Each must be:

- **A real mechanism** — the kind of thing some other software genuinely does. "One thread per
  connection" and "one process per connection" are both real designs, and a reader has to know
  the subject to tell which applies. An invented answer is obvious and teaches nothing.
- **Wrong as the answer to this question.** It does not have to be false everywhere. It has to
  be not what {{SKILL}} does here.
- **The same kind of thing as the right answer.** If the right answer names a strategy, the
  wrong ones name strategies. If it names a guarantee, they name guarantees. Four answers of
  different kinds is a question that answers itself.

Rules for every question:

1. The stem may name {{SKILL}} — that is how an interviewer asks. **No option may name it**, or
   anything that identifies it. An option naming its own technology hands over the answer.
2. Ask about a mechanism, a guarantee, or a behaviour: how it works, what it promises, what it
   refuses to do. Never when it was released, who wrote it, what licence it carries, or how
   popular it is. Those test whether someone has memorised a fact.
3. Keep all four options roughly the same length. A conspicuously longer option is a tell.
4. Do not ask a question whose answer is a definition of its own name, or an expansion of an
   acronym. "What does ACID stand for" tests spelling.

Everything must come from the MATERIAL. If it does not say how something works, do not write
that question — write fewer. Three questions a reader learns from beat eight they can guess.

If the material is too thin to ask anything real, return an empty list. That is a correct
answer, and far better than a question about a release date.

TECHNOLOGY: {{SKILL}}

MATERIAL:
{{MATERIAL}}

Return `questions`, each with a `stem`, the `correct` answer, exactly three `wrong` answers, and
an `explanation` of why the correct one is correct.

**Write everything in {{LANGUAGE}}.** Keep technical terms, product names and command names in
their original form — a reader preparing for an interview needs the words the interview will use.
