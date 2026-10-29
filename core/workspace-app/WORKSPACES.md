# Workspace folders: kinds, types and their settings

Every folder listed in `settings.yml`'s `workspaces:` is a workspace. What its page looks like and
what its rows can do come from two ideas that answer different questions:

- **kind** — how the page is laid out. `projects` (a table of project folders) or `files` (a list
  of markdown/media items). Presentation, set in the folder's `presentation:` block.
- **type** — what the projects ARE, and therefore which actions their rows offer. Policy, set with
  the `type:` key, editable from the Settings page.

A control appears only when **both** layers say yes: the folder must ship the script
(`cmd-tools-backup-*.sh`, `cmd-tools-upsun.sh`, …) and the type must want the action. Copying a
stray `cmd` file into a folder no longer grows its interface.

## The types

| Type | For | Project-row actions |
| --- | --- | --- |
| `sites` | Built Drupal sites (dev, test, demos, sandboxes, projects, products, profiles, site-templates, rag, designs) | Build, DDEV menu (+Launch), Upsun menu, Backup, Remove, Graph, RAG, Tests, Checks, Users |
| `code` | Packages and repositories (modules, themes, libraries, recipes, components, forked, graphs) | Build, Backup, Remove, Graph, RAG, Checks |
| `files` | Documents and drafts (docs, worklogs, specs) | none — the page is an item list |
| `media` | Images, recordings and sounds (images, videos, audio) | none — the page is an item list |
| `ai-items` | Claude Code items (agents, skills, prompts) | none — these pages carry their own install/fetch/propose surface |

Defaults live in `core/workspace-app/workspace-types.js`; an unset `type:` resolves to the shipped
default for that folder, so nothing changes until somebody chooses differently. A brand-new
workspace folder defaults by its kind: `projects` → `sites`, `files` → `files`.

## A workspace's settings file

`core/config/workspace.<name>.settings.yml`, all keys optional beyond `doc.name`:

```yaml
doc:
  name: dev                    # the folder under the workspace root
  # path: /elsewhere/dev       # override the location entirely

# What this folder's projects are, and which actions their rows offer.
type: sites                    # sites | code | files | media | ai-items

# What the COMPOSER menu may do on a folder with a composer.json.
composer: full                 # full = install, update, scripts… (dev, test, demos, sandboxes, projects)
                               # manifest (the default) = only add to composer.json, never install

presentation:                  # the card and rail — icon, words, layout
  icon: tabler:code
  label: Dev
  subtitle: Development Projects
  noun: project                # what one item is called
  plural: projects
  kind: projects               # projects | files — the page layout
  also_files: false            # true = project table AND file list (designs)
```

Everything is read live (2s memo): edit the file or use the Settings page, reload, done.

## Adding a new workspace folder

1. Add its name to `workspaces:` in `settings.yml` (or drag-create from the dashboard).
2. Create `core/config/workspace.<name>.settings.yml` with `doc.name` and pick a `type:`.
3. Drop the `cmd-*.sh` scripts it should serve — copy them from a folder of the same type; each
   one self-locates the tooling, so they work wherever they land.
4. Optional: a `presentation:` block for the icon and words, an `AGENTS.md` for sessions.

## Extending a workspace

Per-workspace features beyond the type's action set are plugins — `settings.yml plugins:` decides
which load and which workspaces they apply to, and a plugin can add rail buttons, per-project-row
buttons, fragments and actions without touching core code. See `PLUGINS.md`.
