# @webship/workspace-jira

Jira for the [Webship Workspace](https://github.com/webship/workspace) dashboard, over the Teamwork
Graph CLI (`twg`): the **JIRA** menu on every site row, the workitems list (open, sprint, mine; a key
jumps straight to it), the one-workitem modal (overview, analyze, do the work with Claude Code in a
screen session, runs and logs, comment and worklog when writes are on), the key badge an agent at work
puts on its card, the New-folder option that files a workitem, live project options on the settings
page, and the `twg` session mounted from the host into the dashboard container.

## Use it

```bash
cd ~/workspace
bash core/scripts/plugins.sh --require github:webship/workspace-jira
bash core/scripts/plugins.sh --activate jira
bash core/scripts/plugins.sh --install jira          # then: cd core/workspace-app && ddev restart (the twg mount)
bash core/scripts/plugins.sh --configure jira        # core/config/plugin.jira.settings.yml: site, account, default_project…
```

On the host: `twg login --force` once (the dashboard shares `~/.config/twg`). `scripts/host-install.sh`
installs twg and reports whether it is signed in; `plugins.sh --install` runs its `--check`.

## What the package holds

| Path | What it is |
| --- | --- |
| `src/index.ts` | `register(api)`: the row menu, badge, key link, session hooks, settings options, assistant context, New-folder section, actions and fragments |
| `src/lib/twg.ts` | Whether twg is usable (installed, signed in, up to date), the projects it sees, a project's own `.jira-project` |
| `src/lib/sessions.ts` | The runs a workitem has had: noted when a screen starts, read back live or finished |
| `src/lib/task.ts` | The actions: remember a project, and view / analyze / work / watch / comment / worklog with Claude Code |
| `src/lib/workitems.ts` | The list and the modal, as fragments |
| `ddev/docker-compose.twg.yaml` | Mounts the host's `~/.local/bin` (twg follows updates) and `~/.config/twg` (the session) |
| `config/plugin.jira.settings.yml` | The settings template |
| `scripts/host-install.sh` | The host side: twg installed (sha256-verified), signed in |
| `public/jira.css` | The plugin's styles |
| `features/jira.feature` | Browser scenarios, installed into the dashboard's `tests/features/plugins/jira/` |
