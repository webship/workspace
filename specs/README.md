# Specs

The design artifacts of changes, one folder per change:
`specs/<workspace>/<project>/NNN-topic/{01-story.md,02-analysis.md,03-canvas.md,spec.yml}`.

Written the [Structured-Prompt-Driven Development](https://martinfowler.com/articles/structured-prompt-driven/)
way: the prompt for a change is reviewed and versioned like code, and when reality diverges you fix
the prompt first. Start one with `bash cmd-spdd.sh <workspace>/<project> "what the change is"`;
`AGENTS.md` has the stages, the gates and what is not worth a spec.
