# Plugins

Everything optional is a plugin: an npm package `@webship.co/workspace-<name>`, from the repository `github.com/webship/workspace-<name>` on branch `1.0.x`. The core requires none of them. A plugin requires nothing from the dashboard's files; it is handed an `api` and works through it, so it can be installed from npm and removed without a trace.

## The four steps

| Step | Command | What happens |
| --- | --- | --- |
| require | `webship-workspace plugin require <name>` | `npm install @webship.co/workspace-<name>` into `core/workspace-app/package.json` |
| activate | `webship-workspace plugin activate <name>` | `plugins.<name>.enabled: true` in `settings.yml`; a workspace plugin also joins the `workspaces:` list |
| install | `webship-workspace plugin install <name>` | places what the manifest names: bash functions, commands, compose files, themes, a workspace folder, a settings template, AI agents; recorded in `core/config/plugins.installed.yml` |
| configure | `webship-workspace plugin configure <name>` | its own `core/config/plugin.<name>.settings.yml` |

The same four are buttons on **Settings → Plugins**, below the catalogue. `deactivate` turns one off and keeps its files; `uninstall` removes what install placed. `bash core/scripts/plugins.sh --list` says the step each plugin is at.

## Families

Plugins that do the same job for different services share a base package, so a provider is thin and the surface is one:

- **Hosting** — `@webship.co/workspace-hosting`: one button per provider, with environments and live URLs, get the database and files, deploy, logs, activities and the console. Providers: upsun, acquia, digitalocean, cpanel, aws, azure, godaddy.
- **Forges** — `@webship.co/workspace-forge`: the repository, open issues and pull or merge requests, a request from the current branch, the clone option, and the credential the dashboard uses for the host. Providers: github, gitlab, bitbucket.
- **Container runtimes** — `@webship.co/workspace-container`: a menu for projects on Docker Compose, Lando, Docksal, Podman or Kubernetes.
- **Platforms** — one plugin per platform: its builder and tools (`cmd-<platform>-project.sh`, `cmd-tools-<platform>-cli.sh`), its default accounts, its step pack wired into the testing setup, and its AI agents, placed in the AI Agents folder. `workspace-wordpress` is the first.
- **Workspace folders** — the folder itself as a plugin: its settings file, its commands, its docs. Activating one lists it on the dashboard.

## Writing one

Read [PLUGINS.md](../workspace-app/PLUGINS.md): the manifest (`workspacePlugin` in `package.json`), `register(api)`, the hooks (row menus, pages, fragments, actions, chips, folder setup, forges, open-with, workspace views) and `api.lib`. Types come from `@webship.co/workspace-plugin-api`. The reference plugins are `workspace-upsun` (a hosting provider), `workspace-github` (a forge), `workspace-lando` (a runtime), `workspace-drupal-modules` (a workspace folder) and `workspace-wordpress` (a platform); each has tests, a `features/*.feature` the installer places under the dashboard's browser suite, and a CI workflow.
