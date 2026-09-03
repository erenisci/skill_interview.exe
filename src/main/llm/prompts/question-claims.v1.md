Extract a set of distinguishing claims about a technology from the material below.

A claim is one sentence stating something specific and checkable about the technology. These become the
options of multiple-choice questions, so each one is read on its own, with no surrounding context.

Three rules decide whether a claim is usable:

1. **Never name the technology, and never name its ecosystem.** Write "routes requests to backend services
   based on host and path rules", not "nginx routes requests…". A claim that names its subject gives the
   answer away. This includes giveaway spellings — its command name, its config file name, its company.
2. **State what is distinctive, not what is generic.** "Is open source", "is widely used", and "is written
   in Go" are true of hundreds of technologies and make worthless options. Prefer the thing that would be
   different if you swapped this technology for a competitor: its model, its guarantees, its trade-off, the
   problem it solves differently.
3. **Be self-contained.** No "it also supports…", no "unlike the above". Each claim stands alone.

Everything must come from the MATERIAL. If the material does not say it, do not claim it — a plausible
invention becomes a question with a wrong answer, which is worse than one fewer question.

Write between 4 and 8 claims. Fewer good claims beat more padded ones; if the material only supports four,
write four.

Write in {{LANGUAGE}}. Keep technical terms, product names, and command names in their original form —
never translate them.

TECHNOLOGY: {{SKILL}}

MATERIAL:
{{MATERIAL}}

Return `claims` as an array of strings, each one sentence.
