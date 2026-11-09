# Getting started

The Webship Workspace is a folder (`~/workspace` by default) with a web dashboard in it. The dashboard runs in a DDEV container and drives everything else: it builds, starts, stops, backs up and restores real projects through the `cmd-*.sh` scripts in each workspace folder, with live terminal output, and it embeds an AI assistant that knows the page you are on.

## What you need

- Node.js 20 or newer (24 is what the dashboard runs on).
- Docker, and [DDEV](https://ddev.readthedocs.io/en/stable/users/install/). DDEV is the only runtime the core needs; other container runtimes come as plugins.
- A terminal. Windows works through WSL2.

## The first hour

```bash
npm install -g @webship.co/workspace
webship-workspace init ~/workspace
```

`init` copies the core into the folder, writes `core/config/settings.yml` from the lean template (no workspace folders, no plugins), installs the dashboard's dependencies and starts it. Open https://workspace.ddev.site.

The dashboard is empty on purpose. Add a workspace folder:

```bash
webship-workspace plugin require dev
webship-workspace plugin activate dev
webship-workspace plugin install dev
```

Now `dev/` exists with its builders (`cmd-drupal11-recommended-project.sh`, `cmd-webship11-0-x-project.sh`, …) and its settings file, and the dashboard shows the Dev workspace with a Build button. Build a site from the dashboard, or from the folder:

```bash
cd ~/workspace/dev
bash cmd-drupal11-recommended-project.sh mysite
```

Every build goes through DDEV; the site answers at `https://mysite.ddev.site`.

## Then

- **Settings → Plugins** shows the catalogue. Add the GIT menu (`git`), the Web IDE (`ide`), a hosting provider (`upsun`, `acquia`, …), a git forge (`github`, `gitlab`, `bitbucket`), or more workspace folders (`test`, `drupal-modules`, `docs`, `ai-agents`, …).
- Each plugin with settings gets its own file, `core/config/plugin.<name>.settings.yml`, edited from Settings. Secrets live there, never in `settings.yml`.
- `webship-workspace update ~/workspace` refreshes the core from a newer package without touching your settings files.

## Where things are

| Path | What it is |
| --- | --- |
| `core/workspace-app` | The dashboard (Node.js + HTMX), a DDEV project of its own |
| `core/scripts` | The bash tooling every `cmd-*.sh` sources: bootstrap, builders, `plugins.sh` |
| `core/config` | `settings.yml`, one `workspace.<key>.settings.yml` per folder, one `plugin.<name>.settings.yml` per plugin |
| `<folder>/` | A workspace folder: its `cmd-*.sh` commands and the projects or items it holds |
| `backups/` | What Back up wrote, per workspace and project |
