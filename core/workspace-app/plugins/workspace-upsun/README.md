# @webship/workspace-upsun

Upsun for the [Webship Workspace](https://github.com/webship/workspace) dashboard: the **UPSUN**
menu on every site row (link, environments and live sites, activities, the deploy log, get database
and files, branch and data), a live-site chip on the project card, "Link to Upsun" when a new folder
is made, and the `upsun` CLI in the dashboard container with the host's session mounted in.

## Use it

```bash
cd ~/workspace
bash core/scripts/plugins.sh --require github:webship/workspace-upsun   # npm install into the dashboard
bash core/scripts/plugins.sh --activate upsun                            # plugins.upsun in settings.yml
bash core/scripts/plugins.sh --install upsun                             # scripts, commands, compose, theme
bash core/scripts/plugins.sh --configure upsun                           # core/config/plugin.upsun.settings.yml
```

The same four steps are buttons on the dashboard's **Settings → Plugins** page. `--install` is
idempotent and says when the dashboard container needs `ddev restart` (it does the first time: the
compose file mounts `~/.upsun-cli`).

## What the package holds

| Path | What it is |
| --- | --- |
| `index.js` | `register(api)`: the row menu, card chip, actions, fragment, page and New-folder section |
| `lib/link.js` | Whether a project is linked, and to what (its `.upsun/local/project.yaml` and `upsun` remote) |
| `lib/environments.js` | Environments, live URLs, and the get-database-and-files flow |
| `commands/cmd-tools-upsun.sh` | The per-workspace command, installed into every `sites` workspace |
| `scripts/functions/fun-upsun.sh` | The bash functions behind it, sourced by bootstrap once installed |
| `scripts/args/arg-upsun.sh` | Its argparse |
| `scripts/upsun-ai.sh` | Upsun's agent skill and read-only MCP |
| `scripts/host-install.sh` | The host side: the CLI, the token check, the AI toolkit |
| `ddev/docker-compose.upsun-cli.yaml` | Mounts the host's upsun session into the dashboard container |
| `config/plugin.upsun.settings.yml` | The settings template (`cli_token`) |
| `config/theme.upsun.yml` | A dashboard theme in Upsun's colours |
| `public/upsun.css` | The plugin's styles, appended to the dashboard stylesheet |

The `workspacePlugin` block in `package.json` is the manifest the installer reads.
