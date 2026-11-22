# Runtimes: DDEV, Docker, Podman and Kubernetes

The Webship Workspace is container-based. A site you build runs on a container runtime, and DDEV is the default. A builder can also build on Docker Compose, on Podman or on a Kubernetes cluster.

This page says what works today. It is updated as each part is proven on a real build.

## What works where

| | DDEV | Docker Compose | Kubernetes | Podman |
|---|---|---|---|---|
| Build and install a Drupal site (the core's Drupal-family builders) | Yes | Yes | Yes | Yes |
| Composer, Drush and commands in the site | Yes | Yes | Yes | Yes |
| Export and import the database | Yes | Yes | Yes | Yes |
| The site's row in the dashboard: state, link, menus | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman |
| The Tests menu, test users, backup, restore and remove | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman |
| Clone, import a database from the menu, snapshots, add-ons, extra domains, captured mail | Yes | On the way | On the way | On the way |
| A WordPress site (the WordPress plugin): build and install, WP-CLI, test users, the tests, the database, the row, remove | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman |
| The other platform plugins' builders (Laravel, Joomla, …) | Yes | On the way | On the way | On the way |
| The dashboard itself | Yes | Yes | Yes, with limits (below) | On the way |

Lando and Docksal are planned next. Today their plugins add a menu to a project that already has a `.lando.yml` or a `.docksal/` folder.

"Yes" means it was run on a real build: Drupal 11 built and installed, its front and login pages answering, `drush status` bootstrapping, and the database exported and imported back. For the dashboard rows it means a real site driven in a browser: the row, the menu, stop and start, the tests set up and run, the test users added and cancelled, a backup, a remove and a restore. For WordPress it means the plugin's builder with `--install --add-users`, the front page and a login to the administration, `cmd-tools-wordpress-cli.sh`, the test users added and cancelled, the suite of `cmd-tools-testing.sh` green in the tests container, a mail caught by Mailpit, the database exported and imported back, the row in the dashboard and a remove.

## Build on a runtime

```bash
bash dev/cmd-drupal11-recommended-project.sh mysite --install                       # DDEV, the default
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime docker      # Docker Compose
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime kubernetes  # a Kubernetes cluster
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime podman      # Podman
```

Without `--runtime`, a build takes `WORKSPACE_RUNTIME` from the environment, then `container.runtime` in `core/config/settings.yml`, then DDEV.

The build ends with the site's address:

| Runtime | Address |
|---|---|
| DDEV | `https://<name>.ddev.site` |
| Docker Compose, Podman | `http://127.0.0.1:<port>`, a free port chosen at the build and kept in `compose.yaml` |
| Kubernetes | `http://<node address>:<port>`, a NodePort of the cluster |

## What a project carries

A project's runtime is what its folder holds:

- **DDEV:** `.ddev/config.yaml`.
- **Docker Compose and Podman:** `compose.yaml`, with an `x-webship:` block (the runtime, the project type, the PHP and database versions, the port, and `platform:` when a plugin claims the project), and `.webship/runtime/Dockerfile`, the image of its web service. You can run it without the Workspace: `docker compose up -d`.
- **Kubernetes:** the same `compose.yaml`, plus `k8s/` (a `kustomization.yaml` and the manifests: a namespace `ws-<name>`, Deployments and Services for the web, the database and the mail catcher, a volume claim for the database). You can apply it yourself: `kubectl apply -k k8s`.

Each has a web service (Apache and PHP with Composer and WP-CLI), a MariaDB database and a Mailpit mail catcher.

## Platform plugins

A platform plugin's builder takes `--runtime` like the core's:

```bash
bash dev/cmd-wordpress-project.sh mysite --install --add-users --runtime docker
bash dev/cmd-wordpress-project.sh mysite --install --add-users --runtime kubernetes
```

WordPress is the first, and the reference: `@webship.co/workspace-wordpress`. The other platform plugins follow it one by one, and each says in its README what was run.

What the layer gives a plugin:

- **`ddev wp`:** WP-CLI is in the web image, as it is in DDEV's.
- **The project type** a builder gives `ddev config --project-type=` is kept in `compose.yaml`. The dashboard reads it as it reads DDEV's: a `wordpress` project gets the WordPress plugin's test users.
- **The claim:** a plugin that builds on a type of no platform (`php`, `generic`) calls `rt_claim <plugin>` after `ddev config`. It writes `platform: <plugin>` in the `x-webship:` block. That is on a runtime what the plugin's own `.ddev/config.<plugin>.yaml` is on DDEV.
- **`rt_is_platform <folder> <name>`:** is this project that platform's, on any runtime.
- **`rt_url`:** the address of the site, on any runtime.
- **The site reaches itself at its own address.** On Docker Compose and Podman the web container also answers on the site's port (`WEBSHIP_PORT` in `compose.yaml`), so `http://127.0.0.1:<port>` is the site from inside it too. On Kubernetes a pod reaches the node's address. A platform's scheduled tasks and its own checks need that: WordPress's WP-Cron and Site Health.

What a plugin changes, what it must never do and the checklist to prove it are in [plugins-on-runtimes.md](plugins-on-runtimes.md).

The `php` stack is the only one so far: Apache, PHP and MariaDB. A platform on Node.js, Python, Java or .NET, or one that needs PostgreSQL or a service of its own, still builds on DDEV only.

## In the dashboard

A site on Docker Compose, Podman or Kubernetes has the row a DDEV project has. Its card shows **Running** or **Stopped** (the chip is the switch), links to the site's own address, and carries a **DOCKER**, **PODMAN** or **K8S** menu where the DDEV menu sits: start, stop, restart, describe, the web logs, a shell in the web container, export the database, back up, delete the containers (or the namespace) and remove the project. Each entry runs as a screen session, like the DDEV menu's.

- **Composer** runs in the site's own web container.
- **Tests** sets up and runs the site's webship-js suite. The web image has no Node.js, so the suite runs in a tests container beside the site: one image the Workspace builds once (Node.js 24 and the libraries Playwright's browsers need), on the host's network, against the site's address. The browsers are kept in one volume every project shares, `webship-workspace-tests`. **Node** runs there too.
- **Test users**, **backup**, **restore** from the Backups page and **remove** work as on DDEV. Remove takes the runtime's side down first (the containers and the database volume, or the namespace), then the image built for the site, then the folder.
- The state is read from `docker compose ls`, `podman ps` and `kubectl get deploy`, each with a timeout. A runtime that does not answer shows **unknown**, and the page does not wait for it.

What is not there yet is said in the menu instead of offered: clone, importing a database, snapshots, add-ons, extra domains and captured mail.

## Podman

Podman runs the same `compose.yaml` as Docker, through `podman compose`, without a daemon and without root. Two things are its own:

- **Its socket must be running:** `systemctl --user start podman.socket` (add `enable` to keep it across restarts). `podman compose` hands the file to the Compose plugin, which talks to that socket.
- **The web service keeps your user:** its compose file sets `userns_mode: keep-id`, so the site's files belong to you, and it starts as root inside the container so Apache can listen on port 80.

Proven on Podman 4.9.3, rootless: Drupal 11 built and installed, its pages answering, Drush working, and the database exported and imported back. The dashboard's row and tools on a Podman site use the same code as Docker and have not been run on a real Podman yet.

## Which cluster

A Kubernetes build goes to the context named in `WORKSPACE_KUBE_CONTEXT`.

With none set, the Workspace uses a local [kind](https://kind.sigs.k8s.io/) cluster named `webship`, and creates it on the first build, with your home folder mounted into its node so the pods see the code where it is. This needs `kind` and `kubectl` installed. A project must live under your home folder for that.

On a cluster of your own, the web image must be one the cluster can pull, and the code must be reachable by its nodes: the manifests mount the project folder from the node.

## The dashboard itself

The dashboard runs in a DDEV project by default. It also runs on Docker Compose and on Kubernetes, without DDEV on the machine:

```bash
webship-workspace init ~/workspace                        # DDEV, the default: https://workspace.ddev.site
webship-workspace init ~/workspace --runtime docker       # Docker Compose: http://127.0.0.1:3000
webship-workspace init ~/workspace --runtime kubernetes   # a Helm chart, on your current Kubernetes context
webship-workspace start ~/workspace                       # and stop, status, update: on the runtime it was made for
```

`init --runtime` also writes `container.runtime` to `settings.yml`, so the builders build sites on the same runtime by default. You can change that line later without moving the dashboard.

To move the dashboard of a workspace to another runtime, run `init` on it again with the other `--runtime`. The old container or pod is stopped; a DDEV project is left for you to stop.

Both use one image, `core/docker/Dockerfile`: Node.js 24, git, screen, Python, pandoc, the Docker client with the compose plugin, kubectl, kind and the Claude Code CLI. The app is not in the image. The workspace is mounted at the same path it has on the host, because the dashboard builds sites through the host's Docker, and the Docker daemon reads a site's folder on the host.

Outside DDEV the dashboard has no `workspace.ddev.site`. It answers on a plain address, and its pages are paths on it: `/dev`, `/settings`, `/screens`.

### On Docker Compose

`init --runtime docker` writes `core/docker/.env` (the workspace's path, your user and group numbers, the group of the Docker socket, the port) and runs `docker compose up` in `core/docker`.

- **The address** is `http://127.0.0.1:<port>`, on this machine only. `--port` chooses the port: 3000, or the next free one.
- **The container** runs as your user, on the host's network, with the host's Docker socket. The sites it builds are containers beside it, and answer on `127.0.0.1:<port>` as they do without it.
- **Another name:** to put a domain in front of it, add the name to `WORKSPACE_ALLOWED_HOSTS` in `core/docker/.env`. The dashboard refuses names it does not know.
- **The AI Assistant** uses your Claude Code login when `~/.claude` and `~/.claude.json` exist (`compose.claude.yaml`). `--no-claude` leaves it out.
- **A restart** of the dashboard (a plugin step, an update) restarts its process, not its container, so the screen sessions running in it go on.
- **DDEV sites are not built from it.** The image has no `ddev`. Sites are built on Docker Compose and on Kubernetes. `docker build --build-arg DDEV_VERSION=<version>` adds the binary, and this has not been proven.

### On Kubernetes

`core/k8s` is a Helm chart. Helm, because a cloud's cluster needs values the chart already has a place for: a storage class, an Ingress, an image from a registry. It needs `kubectl` and `helm` on your machine.

`init --runtime kubernetes` builds the image, loads it into a kind cluster, writes `core/k8s/values.local.yaml` and installs the chart: a Deployment, a Service, a ServiceAccount and its role. `--context`, `--namespace` and `--image` choose the cluster, the namespace and an image the cluster can pull.

- **The workspace** is a folder of the node, mounted at the same path (`workspace.hostPath`). That is a local cluster (kind, with your home folder mounted into its node) or a single-node one. Without `hostPath` the chart makes a volume claim and fills it from the npm package.
- **The address** is the node's address and a NodePort, or `kubectl port-forward`. The chart also has an Ingress, off by default.
- **Its rights:** the dashboard runs `kubectl` from its pod to build sites, each in a namespace `ws-<name>`. Its role covers namespaces, deployments, services, volume claims, pods, `pods/exec` and `pods/log`. A Kubernetes role cannot be limited to namespaces by a prefix, so a ValidatingAdmissionPolicy refuses every change the dashboard asks for outside `ws-*` (Kubernetes 1.30 or newer).
- **Sites built from the pod** take a web image the cluster already has, `webship-workspace-php:<php version>`, because a pod has no Docker to build one with. On a kind cluster `init` builds and loads it for PHP 8.3 (`--php` for another version).

Not there yet on Kubernetes:

- The **Tests** menu and **Node** of a site, from a dashboard in a pod: they run in a container started with Docker, and a pod has none. The menu says so. From a machine with Docker and the same workspace they work: `bash cmd-tools-testing.sh <site>` in the site's folder.
- Sites from a dashboard whose workspace is a volume claim: a site's pod mounts its code from the node. That dashboard runs, with its pages, settings and plugins.
- An image in a registry: none is published yet, so a cluster that is not kind needs `--image` with one you pushed.
- A cluster of a cloud: the chart was run on a local kind cluster only.

### On a server of a cloud

`core/docker/cloud-init.yaml` is the user data of a fresh Ubuntu 24.04 server. It installs Docker and Node.js, makes a `webship` user, runs `webship-workspace init … --runtime docker`, and, when you give it a domain, puts Caddy in front: a certificate for the domain, and a password before anything reaches the dashboard. Without a domain nothing is opened to the internet, and you reach the dashboard through an SSH tunnel.

It is the same file on every cloud. Its install script was run by hand in a fresh Ubuntu 24.04 container, and the Caddy part with a local certificate. It has not been run by cloud-init on a real server yet: the guides for each cloud, and the first installs there, are still to come.

On a server the sites the dashboard builds answer on the server's own `127.0.0.1:<port>`. Reaching them from your machine needs an SSH tunnel for now.

## How it works

The builders and the tools keep calling DDEV's commands (`ddev config`, `ddev start`, `ddev composer`, `ddev drush`, `ddev exec`, `ddev export-db`). On a DDEV project those are DDEV itself. On another runtime, `core/scripts/functions/fun-runtime.sh` gives each command its meaning there: `docker compose`, `podman compose` or `kubectl`. So a builder written for DDEV works on the others without a change, as long as it uses those commands.

The work is tracked in [webship/workspace#694](https://github.com/webship/workspace/issues/694).
