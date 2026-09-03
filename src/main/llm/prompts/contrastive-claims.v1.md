Write statements that separate two similar technologies.

{{SKILL_A}} and {{SKILL_B}} are close enough that a developer could confuse them. Your task is to write, for each
one, the things that are true of it and **not** true of the other.

This is the whole point, so be strict about it: a statement true of both is worthless here. It will be shown as one
of four options in a question about a single technology, and a statement true of both would make two options correct
— the reader answers correctly and is told they are wrong.

Four rules decide whether a statement is usable:

1. **True of its own technology, false of the other.** Not "different in emphasis" — actually false. If both handle
   TLS, do not write "terminates TLS" for either; write what each does with it that the other does not.
2. **Never name either technology, or anything that identifies one.** Write "discovers backend services from
   container labels", not "Traefik discovers…". This includes command names, config file names, and companies — a
   statement that names its subject hands over the answer.
3. **State a mechanism or a guarantee, not a fact about popularity, licensing, age, origin, or process names.**
   "Released under the Apache License 2.0", "serves 23% of the busiest websites", and "runs as a daemon named
   httpd" all separate the two perfectly and teach nothing — they test whether the reader has memorised trivia,
   which is not what the reader came for. Prefer how it works, what it promises, and what it refuses to do.
   If the only separation you can find is trivia, write nothing for that side.
4. **Be self-contained.** No "unlike the other", no "it also supports". Each statement is read alone.

Everything must come from the MATERIAL. If the material does not support a separation, do not invent one — write
fewer statements. Two solid pairs beat six padded ones, and a fabricated difference becomes a question with a wrong
answer.

If the material genuinely shows no difference worth stating, return empty arrays. That is a correct answer.

Write between 0 and 5 statements per side, in {{LANGUAGE}}. Keep technical terms, product names, and command names in
their original form — never translate them.

TECHNOLOGY A: {{SKILL_A}}

MATERIAL ABOUT {{SKILL_A}}:
{{MATERIAL_A}}

TECHNOLOGY B: {{SKILL_B}}

MATERIAL ABOUT {{SKILL_B}}:
{{MATERIAL_B}}

Return `aClaims` — true of {{SKILL_A}} and false of {{SKILL_B}} — and `bClaims`, true of {{SKILL_B}} and false of
{{SKILL_A}}. Each is an array of one-sentence strings.
