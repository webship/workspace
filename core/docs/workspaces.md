# Workspaces

A workspace is a folder under the workspace root with a `workspace.<key>.settings.yml` in `core/config` and a set of `cmd-*.sh` commands. `settings.yml`'s `workspaces:` list says which folders exist and in what order the dashboard shows them.

## Types

| Type | What the folder holds | What a row offers |
| --- | --- | --- |
| `sites` | Real projects with a DDEV environment | build, start/stop, launch, back up, clone, remove, the plugins' menus |
| `code` | Repositories checked out to work on | backup, remove, the menus that make sense without a site |
| `files` | Markdown items, edited in place | open, edit |
| `media` | Recordings and images | play, review |
| `ai-items` | Agents, skills, commands and prompts | install into `~/.claude`, update from a repository |

## Builders

A `cmd-*-project.sh` in a `sites` folder builds a project: Drupal (9 to 12), Drupal CMS, the Webship distributions. Each carries a `# workspace-name:` header the dashboard shows in its Build dropdown, declares its own distribution values, and runs everything through DDEV (`ddev config`, `ddev composer`, `ddev drush`), never against the host. Every build runs Node.js 24.

## Commands

Every `cmd-*.sh` finds the tooling from its own path (`core/scripts/bootstrap.sh`), so a fresh workspace needs no environment variables. Tools (`cmd-tools-*.sh`) act on an existing project: back it up, restore it, run its tests, link it to a host. A plugin's command is placed into the folders its manifest names, with `__WORKSPACE__` filled in.

## Each folder is a plugin

`@webship.co/workspace-dev`, `-test`, `-drupal-modules`, `-drupal-themes`, `-docs`, … carry the folder's settings template, commands and docs. `webship-workspace plugin require|activate|install <name>` adds one; the folder, its content and its settings stay when it is deactivated.
