# Worklogs

Session worklogs: what was done on a given day, and — more usefully — what was
learned. One file per session, named `session-worklog-<YYYY-MM-DD>-<topic>.md`.

A worklog is not documentation. `docs/` holds reference material that stays
true; a worklog is dated and stays as written, so a later session can see what
was known at the time and why a decision was made. That is why worklogs are
never edited to match how things turned out — a correction belongs in the next
worklog, or in `docs/`.

## Writing one

Name it `session-worklog-<YYYY-MM-DD>-<topic>.md` and cover:

- what was worked on, in the order it happened
- decisions, and what was rejected — the alternative not taken is the part
  a later session cannot reconstruct
- what broke, and what the cause turned out to be
- what is still open

## Tooling

- `cmd-tool-backup-worklog.sh <name>` — archive one worklog into `backups/worklogs/`.
- `cmd-tool-git-change-filemode-to-false.sh <name>` — turn off filemode tracking.

Read them from the dashboard at `https://worklogs.workspace.ddev.site`.
