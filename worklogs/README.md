# Worklogs.
--

Session worklogs: what was done on a given day, and — more usefully — what was
learned. One file per session, named `session-worklog-<YYYY-MM-DD>-<topic>.md`.

A worklog is not documentation. `docs/` holds reference material that stays
true; a worklog is dated and stays as written, so a later session can see what
was known at the time and why a decision was made.

## Two kinds of worklog

**Session worklogs** — written by hand at the end of a working session:
`session-worklog-<YYYY-MM-DD>-<topic>.md`.

**Activity worklogs** — generated from platform activity by the
**`vardot-worklog-from-git-actions`** agent, which pulls straight from the
APIs of **GitHub**, **GitLab** (including self-hosted, so `git.drupalcode.org`)
and **Bitbucket** (Cloud or Server/Data Center):

> generate my worklog for last week

It produces a dated multi-file set — the full activity log, a scope-filtered
log, a technical summary and a plain-language one for a manager, plus a
per-platform raw detail file. **This folder is its output directory**, and it
reads that from the workspace `CLAUDE.md`, so it lands here without being told.
It never invents data: a platform it could not reach is named in the output.

Worth recording in a session worklog:

- what changed, with the issue and PR numbers;
- **findings** — the traps, the upstream bugs, the things that cost an hour;
- what was left unverified, stated plainly;
- what the next session should open with.

Render one to PDF or HTML from the dashboard, or with the docs tooling:

```
pandoc session-worklog-2026-07-27-webship-workspace.md -o worklog.pdf --pdf-engine=weasyprint
```
