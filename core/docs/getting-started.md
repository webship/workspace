# Getting started

The Webship Workspace is a folder (`~/workspace` by default) with a web dashboard in it. The dashboard runs in a container (DDEV by default, or Docker Compose or Kubernetes) and drives everything else: it builds, starts, stops, backs up and restores real projects through the `cmd-*.sh` scripts in each workspace folder, each run in a screen session you read on the **Screens** page, and it embeds an AI assistant that knows the page you are on.

## What you need

- Node.js 20 or newer (24 is what the dashboard runs on).
- Docker, and [DDEV](https://ddev.readthedocs.io/en/stable/users/install/). DDEV is the default. Without it, the dashboard runs on Docker Compose (Docker alone) or on Kubernetes (`kubectl` and `helm`): see below.
- A terminal. Windows works through WSL2.

## The first hour

```bash
npm install -g @webship.co/workspace
webship-workspace init ~/workspace
```

`init` copies the core into the folder, writes `core/config/settings.yml` from the lean template (no workspace folders, no plugins), installs the dashboard's dependencies and starts it. Open https://workspace.ddev.site.

Without DDEV, name the runtime:

```bash
webship-workspace init ~/workspace --runtime docker       # http://127.0.0.1:3000
webship-workspace init ~/workspace --runtime kubernetes   # the address is printed at the end
```

The dashboard then answers on that address instead of `workspace.ddev.site`, and the builders build sites on that runtime by default. `webship-workspace start`, `stop` and `status` work on all three. [Runtimes](runtimes.md#the-dashboard-itself) has the details and the limits.

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

A build goes through DDEV by default, and the site answers at `https://mysite.ddev.site`. On Docker Compose it answers at `http://127.0.0.1:<port>`, printed at the end of the build.

A command started from the dashboard (a build, a row's menu, a tool, a plugin step) runs in a screen session. The page shows a short notice, what started and **Open in Screens**, and never a terminal at the bottom of it: **Open in Screens** opens Screens in a window over the page you are on, with that session first; its output is there also after the session has ended. A fresh workspace needs nothing for this: `screen` is in the dashboard's image. Two cases need one step each:

- The dashboard run with node on the machine (no container): `screen` must be installed there (`bash core/scripts/install.sh`, or `sudo apt install -y screen`).
- Sessions on your own machine, attached with `screen -r <session>` from your own terminal: start the host runner once, `bash core/workspace-app/scripts/screen-host.sh --start`.

When no session can be started the command is not run: the answer says what is missing, the step that fixes it, and the command line to copy into your own terminal.

## Then

- **Settings → Add a plugin** shows the catalogue. Add the GIT menu (`git`), the Web IDE (`ide`), a hosting provider (`upsun`, `acquia`, …), a git forge (`github`, `gitlab`, `bitbucket`), or more workspace folders (`test`, `drupal-modules`, `docs`, `ai-agents`, …).
- A plugin can need another one: a platform plugin (`wordpress`, `drupal`, …) needs a sites folder for its builder and the AI Agents folder for its agents. `webship-workspace plugin activate wordpress --with-needs` adds what is missing first, and the Activate button asks; see [Plugins](plugins.md).
- `webship-workspace doctor` lists the commands the core and your plugins call on this machine (git, node, docker, ddev, python, a provider's CLI, …): found, with the version, or missing, with how to install it. It installs nothing; `init` says what is missing before it starts.
- Each plugin with settings gets its own file, `core/config/plugin.<name>.settings.yml`, edited from Settings. Secrets live there, never in `settings.yml`.
- `webship-workspace update ~/workspace` refreshes the core from a newer package without touching your settings files or the plugins you required.

## Where things are

| Path | What it is |
| --- | --- |
| `core/workspace-app` | The dashboard (Node.js + HTMX), a DDEV project of its own |
| `core/docker` | The dashboard's image, its compose file and the cloud-init file, for running it without DDEV |
| `core/k8s` | The dashboard's Helm chart |
| `core/scripts` | The bash tooling every `cmd-*.sh` sources: bootstrap, builders, `plugins.sh` |
| `core/config` | `settings.yml`, one `workspace.<key>.settings.yml` per folder, one `plugin.<name>.settings.yml` per plugin |
| `<folder>/` | A workspace folder: its `cmd-*.sh` commands and the projects or items it holds |
| `backups/` | What Back up wrote, per workspace and project |
