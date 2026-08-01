# Commands

Every `cmd-*.sh` in the workspace, in one place.

The scripts themselves stay in the folder they belong to — a builder for `dev` lives in `dev/` because
that is where it runs from, and moving them here would break every path in the harness. So this
workspace holds no builders of its own. It is a **view over the others**, plus the operations that are
awkward when 166 commands are spread across twenty folders.

```bash
bash cmd-tools-commands.sh                          # every command, grouped by workspace
bash cmd-tools-commands.sh --workspace dev          # just one workspace

bash cmd-tools-commands.sh --new cmd-tools-thing.sh --workspace dev --label "My Thing"
bash cmd-tools-commands.sh --clone cmd-tools-thing.sh --to cmd-tools-other.sh
bash cmd-tools-commands.sh --clone cmd-tools-thing.sh --to cmd-tools-other.sh --workspace demos

bash cmd-tools-commands.sh --list-remote             # what the tooling repository has vs this machine
bash cmd-tools-commands.sh --diff  cmd-tools-thing.sh
bash cmd-tools-commands.sh --pull  cmd-tools-thing.sh
```

The dashboard (`https://commands.workspace.ddev.site`) does the same from buttons, shelling out to this
one command so the two cannot drift apart.

## New and clone

`--new` scaffolds the bootstrap chain correctly: the script locates the tooling from its own path, reads
its workspace's settings file, and carries the `# workspace-name:` header the smoke test requires.

`--clone` with `--workspace` **retargets** the copy — it rewrites `workspace.<old>.settings.yml` to the
new workspace and repoints `<old>/` paths. A builder copied from `dev` to `demos` that still read
`workspace.dev.settings.yml` would build into the wrong folder, which is the one mistake a clone must
not make. Prose and echoed text naming the old workspace are left alone: rewriting a bare workspace
name like `test` would corrupt ordinary words. Read the copy before running it.

## Syncing with the repository

`--list-remote` reports each command as **same**, **differs**, or **not here**, against
`the tooling repository` at its release branch. `--pull` brings one down, including one this machine does not
have at all.

**A pull can move you backwards.** The release branch does not carry work that is still in review, so
pulling can undo a local fix. When the copy here differs, the version being replaced is saved to
`backups/commands/` first and the path is printed.

## Proposing a command to the repository

Nothing here writes to the repository. Publishing goes through the AI agent, which follows the workspace's
rules — issue first, branch on a fork, one pull request, Checkpoints checklist, human-review boxes left
unticked, never a merge and never a push to the release branch:

```bash
bash cmd-tools-commands.sh --propose cmd-tools-thing.sh --summary "what it is for"
```

That prints exactly what would happen and **creates nothing**. Add `--confirm` to go ahead. Filing an
issue and opening a pull request are public, so they are never a side effect of asking a question.

In the dashboard the same two steps are **Show me first** and **File the issue and open the PR**.
