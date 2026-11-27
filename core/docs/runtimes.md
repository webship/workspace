# Runtimes: DDEV, Docker, Podman, Kubernetes, Lando and Docksal

The Webship Workspace is container-based. A site you build runs on a container runtime, and DDEV is the default. A builder can also build on Docker Compose, on Podman, on a Kubernetes cluster, on Lando or on Docksal.

This page says what works today. It is updated as each part is proven on a real build.

## What works where

| | DDEV | Docker Compose | Kubernetes | Podman | Lando | Docksal |
|---|---|---|---|---|---|---|
| Build and install a Drupal site (the core's Drupal-family builders) | Yes | Yes | Yes | Yes | Yes | Yes |
| Composer, Drush and commands in the site | Yes | Yes | Yes | Yes | Yes | Yes |
| Export and import the database | Yes | Yes | Yes | Yes | Yes | Yes |
| The site's row in the dashboard: state, link, menus | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman | Yes | Yes |
| The Tests menu, test users, backup, restore and remove | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman | Yes | Yes |
| Import a database from the menu, the mail a site captured | Yes | Yes | Yes | Yes | Yes | Yes |
| Clone, snapshots, add-ons, extra domains | Yes | On the way | On the way | On the way | On the way | On the way |
| A WordPress site (the WordPress plugin): build and install, WP-CLI, test users, the tests, the database, the row, remove | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman | Yes | Yes |
| A WooCommerce shop, a Joomla site, a phpBB board and a MediaWiki wiki (their plugins): build and install, the tool, test users, the tests, the database, the row, remove | Yes | Yes | Yes (for Joomla the tests and the row were not run there yet) | The same code as Docker, not yet run on a real Podman | On the way | On the way |
| A Laravel app (the Laravel plugin): build and install, Artisan, test users, the tests, mail, the database, the row, remove | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman | Yes | Yes |
| The tracker plugins Gitea and Forgejo, Plane, Leantime, Kanboard, Wekan and Vikunja: build and install with their default accounts and sample content, the tool, the test users, their step pack's suite, the work items, the row, remove | Yes | Yes | Yes | Yes | Not yet | Not yet |
| The OpenProject and Redmine plugins: the same | Yes | Yes | Not yet (OpenProject: [webship/workspace-openproject#11](https://github.com/webship/workspace-openproject/issues/11); Redmine: [webship/workspace-redmine#11](https://github.com/webship/workspace-redmine/issues/11)) | Not yet (the same issues) | Not yet | Not yet |
| The Taiga plugin: the same | Yes | Not yet ([webship/workspace-taiga#3](https://github.com/webship/workspace-taiga/issues/3)) | Not yet (the same issue) | Not yet (the same issue) | Not yet | Not yet |
| The other platform plugins' builders (TYPO3, Magento, …) | Yes | On the way | On the way | On the way | On the way | On the way |
| The DATABASE menu of a MariaDB site (the MariaDB plugin): the console, tables and sizes, export and import | Yes | Yes (the console shows no prompt) | Yes (the console shows no prompt) | The same code as Docker, not yet run on a real Podman | Not yet run | Not yet run |
| The DATABASE menu of a MySQL or PostgreSQL site (their plugins) | Yes | PostgreSQL: yes (a generic stack, #841); MySQL: on the way, the layer builds MariaDB | On the way | On the way | On the way | On the way |
| The DATABASE menu of a site's SQLite files (the SQLite plugin): tables and sizes, copies out and back | Yes, with the console | Yes (no console yet) | Yes (no console yet) | The same code as Docker, not yet run on a real Podman | Not yet run | Not yet run |
| A web admin from the DATABASE menu (Adminer, phpMyAdmin) | Yes: DDEV's official add-ons | On the way | On the way | On the way | On the way | On the way |
| The dashboard itself | Yes | Yes | Yes, with limits (below) | On the way | No: it runs on DDEV, Docker Compose or Kubernetes, and builds Lando sites from there | No: it builds Docksal sites from DDEV, Docker Compose or Kubernetes |

"Yes" means it was run on a real build: Drupal 11 built and installed, its front and login pages answering, `drush status` bootstrapping, and the database exported and imported back. For the dashboard rows it means a real site driven in a browser: the row, the menu, stop and start, the tests set up and run, the test users added and cancelled, a backup, a remove and a restore. For WordPress it means the plugin's builder with `--install --add-users`, the front page and a login to the administration, `cmd-tools-wordpress-cli.sh`, the test users added and cancelled, the suite of `cmd-tools-testing.sh` green in the tests container, a mail caught by Mailpit, the database exported and imported back, the row in the dashboard and a remove. For a tracker plugin it means its builder with `--install --add-users --sample-content` on that runtime, its step pack's whole suite run twice against the site with the site's counts the same after each run, the pack's must-fail check, stops and starts of the project, the plugin's dashboard features (the row, the runtime's menu, the test users, the work items) and a remove.

## Build on a runtime

```bash
bash dev/cmd-drupal11-recommended-project.sh mysite --install                       # DDEV, the default
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime docker      # Docker Compose
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime kubernetes  # a Kubernetes cluster
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime podman      # Podman
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime lando       # Lando
bash dev/cmd-drupal11-recommended-project.sh mysite --install --runtime docksal     # Docksal
```

Without `--runtime`, a build takes `WORKSPACE_RUNTIME` from the environment, then `container.runtime` in `core/config/settings.yml`, then DDEV.

The build ends with the site's address:

| Runtime | Address |
|---|---|
| DDEV | `https://<name>.ddev.site` |
| Docker Compose, Podman | `http://127.0.0.1:<port>`, a free port chosen at the build and kept in `compose.yaml` |
| Lando | `http://127.0.0.1:<port>`, a free port chosen at the build and kept in `.lando.yml` |
| Docksal | `http://<name>.docksal.site`, through Docksal's own proxy |
| Kubernetes | `http://<node address>:<port>`, a NodePort of the cluster |

## What a project carries

A project's runtime is what its folder holds:

- **DDEV:** `.ddev/config.yaml`.
- **Docker Compose and Podman:** `compose.yaml`, with an `x-webship:` block (the runtime, the project type, the PHP and database versions, the port, and `platform:` when a plugin claims the project), and `.webship/runtime/Dockerfile`, the image of its web service. You can run it without the Workspace: `docker compose up -d`.
- **Lando:** `.lando.yml`, with the same `x-webship:` block, and `.webship/runtime/` (two small files the app is built with). You can run it without the Workspace: `lando start`.
- **Docksal:** `.docksal/docksal.env` (the stack, the docroot, the images, the database) and `.docksal/docksal.yml`, with the same `x-webship:` block. You can run it without the Workspace: `fin project start`.
- **Kubernetes:** the same `compose.yaml`, plus `k8s/` (a `kustomization.yaml` and the manifests: a namespace `ws-<name>`, Deployments and Services for the web, the database and the mail catcher, a volume claim for the database, and the project's own services, below). You can apply it yourself: `kubectl apply -k k8s`.

The Workspace looks for these from a folder up to the workspace's own folder, never above it, and never takes a temporary folder (`/tmp`, `/var/tmp`, `/dev/shm`, `TMPDIR`) for a project.

Each has a web service (Apache and PHP with Composer and WP-CLI), a MariaDB database and a Mailpit mail catcher.

## Platform plugins

A platform plugin's builder takes `--runtime` like the core's:

```bash
bash dev/cmd-wordpress-project.sh mysite --install --add-users --runtime docker
bash dev/cmd-wordpress-project.sh mysite --install --add-users --runtime kubernetes
```

WordPress is the first, and the reference: `@webship.co/workspace-wordpress`. WooCommerce, Joomla, phpBB, MediaWiki and Laravel build on a runtime too, and so do the tracker plugins (the table above says where). The other platform plugins follow one by one, and each says in its README what was run.

What the layer gives a plugin:

- **`ddev wp`:** WP-CLI is in the web image, as it is in DDEV's.
- **The project type** a builder gives `ddev config --project-type=` is kept in `compose.yaml`. The dashboard reads it as it reads DDEV's: a `wordpress` project gets the WordPress plugin's test users.
- **The claim:** a plugin that builds on a type of no platform (`php`, `generic`) calls `rt_claim <plugin>` after `ddev config`. It writes `platform: <plugin>` in the `x-webship:` block. That is on a runtime what the plugin's own `.ddev/config.<plugin>.yaml` is on DDEV.
- **`rt_is_platform <folder> <name>`:** is this project that platform's, on any runtime.
- **`rt_url`:** the address of the site, on any runtime.
- **The site reaches itself at its own address.** On Docker Compose and Podman the web container also answers on the site's port (`WEBSHIP_PORT` in `compose.yaml`), so `http://127.0.0.1:<port>` is the site from inside it too. On Kubernetes a pod reaches the node's address. A platform's scheduled tasks and its own checks need that: WordPress's WP-Cron and Site Health.

What a plugin changes, what it must never do and the checklist to prove it are in [plugins-on-runtimes.md](plugins-on-runtimes.md).

Two stacks so far: the `php` stack (Apache, PHP, MariaDB), and a generic one for an application in another language, which brings its own language and version (Python, Node.js, Java, .NET, Ruby, Go, or an image of its own), its own server and PostgreSQL, MariaDB or no database (webship/workspace#841): on every runtime: Docker Compose, Podman, Kubernetes, Lando and Docksal. On DDEV a project of any language builds as before, with DDEV's own images and its generic web server. A service of a platform's own (OpenSearch, Redis) is one of the project's own services on Docker Compose, Podman and Kubernetes (`rt_service`, below); on Lando and Docksal it still builds on DDEV only.

A generic stack's server starts once the project's database takes connections, and on Kubernetes a server that stops answering is restarted (webship/workspace#850). Two settings, taken from the environment of `ddev config` and kept in the `x-webship` block:

| Setting | Default | What it is |
| --- | --- | --- |
| `WEBSHIP_DB_WAIT` | 300 | How many seconds the server waits for its database before it says so and stops (every runtime) |
| `WEBSHIP_SERVE_GRACE` | 1800 | On Kubernetes, how many seconds a server that never answered yet has from its container's start (a build, the migrations of a first start) before it is restarted |

```bash
WEBSHIP_DB_WAIT=600 WEBSHIP_SERVE_GRACE=3600 ddev config   # then ddev restart
```

## A project's own services

On Docker Compose, Podman and Kubernetes a project can carry services of its own beside its web server, its database
and the mail catcher: a cache, a queue, an S3 store, a search engine (webship/workspace#900). A plugin calls
`rt_service` after `ddev config`, as it calls `rt_stack`:

```bash
rt_service <name> <image:tag> [--port <n>] [--env-file <file>] [--volume <path>] [--command "<line>"]
```

| Part | What it is |
| --- | --- |
| `<name>` | Its name, which is also its host name in the project's network: lower case, digits and `-`, never `web`, `db`, `mail`, `mail-web` or `daemons` |
| `<image:tag>` | Its image, pinned: a tag that is not `latest`, or a digest |
| `--port <n>` | The port it listens on, inside the project only |
| `--env-file <file>` | A file of the project with its environment, by its path from the project's root. Docker Compose reads a `$` in it as one of its variables: write values without one |
| `--volume <path>` | The folder in the container its data is kept in: a volume of the project's own |
| `--command "<line>"` | Its command line, in place of the image's own (the image's arguments on Kubernetes) |

The Plane plugin's, for example:

```bash
rt_service valkey docker.io/valkey/valkey:7.2.11-alpine --port 6379
rt_service rabbitmq docker.io/library/rabbitmq:3.13.6-alpine --port 5672 --env-file plane/rabbitmq.env --volume /var/lib/rabbitmq
rt_service minio docker.io/pgsty/silo:RELEASE.2026-09-16T00-00-00Z --port 9000 --env-file plane/minio.env --volume /export \
  --command 'server /export --console-address ":9090"'
```

Each is kept in `.webship/runtime/services/<name>.yaml`, and every `ddev config` writes it again:

- **Docker Compose and Podman:** a service of `compose.yaml`. Compose names its container and its volume after the
  project, and the web server waits for it to start. `ddev delete` (compose's `down -v`) and the removal take them with
  the project; no image or volume of the machine is reused by a name of its own, or removed.
- **Kubernetes:** in the project's namespace, a Deployment, a ClusterIP Service on its port (its name is its host name,
  as in `compose.yaml`) and a PersistentVolumeClaim for its volume. Its env file becomes a Secret of the kustomization,
  from a copy in `k8s/services/` that only you can read. Deleting the project deletes its namespace, with all of them.
- **A service whose process stops on its own comes back** (webship/workspace#959): on Docker Compose and Podman it has
  `restart: on-failure`, and on Kubernetes its pod starts it again. A stop of the project stays a stop. The web
  container, the database and the mail catcher keep no restart policy on Docker Compose and Podman: the web container
  ending is how the stack says its application did not start (start.sh). A plugin whose services need to come back
  looks for `rt_service_restart` (it says the policy), and says so on an older core.
- **DDEV:** `rt_service` does nothing: a plugin brings its own `.ddev/docker-compose.<name>.yaml` there.
- **Lando and Docksal:** not yet; `rt_service` says so and writes nothing.

A project without services is written exactly as before.

## In the dashboard

A site on Docker Compose, Podman, Kubernetes, Lando or Docksal has the row a DDEV project has. Its card shows **Running** or **Stopped** (the chip is the switch), links to the site's own address, and carries a **DOCKER**, **PODMAN**, **K8S**, **LANDO** or **DOCKSAL** menu where the DDEV menu sits: start, stop, restart, describe, the web logs, a shell in the web container, export the database, back up, delete the containers (or the namespace) and remove the project. Each entry runs as a screen session, like the DDEV menu's.

- **Composer** runs in the site's own web container.
- **Tests** sets up and runs the site's webship-js suite. The web image has no Node.js, so the suite runs in a tests container beside the site: one image the Workspace builds once (Node.js 26 and the libraries Playwright's browsers need), on the host's network, against the site's address. The browsers are kept in one volume every project shares, `webship-workspace-tests`. **Node** runs there too.
- **Test users**, **backup**, **restore** from the Backups page and **remove** work as on DDEV. Remove takes the runtime's side down first (the containers and the database volume, or the namespace), then the image built for the site, then the folder.
- The state is read from `docker compose ls`, `podman ps`, `kubectl get deploy` and, for Lando and Docksal, their containers by the labels that name the folder (`docker ps`), each with a timeout. A runtime that does not answer shows **unknown**, and the page does not wait for it.

- **The mail it captured** opens the panel a DDEV row opens: the messages the site sent, read, deleted or cleared there, from the stack's Mailpit at the address the project's runtime file names (webship/workspace#859).
- **Import a database…** lists the dumps this workspace holds. It exports the site's database into the backups first, in the same command, since a runtime has no snapshot, then imports through the runtime layer (for PostgreSQL #846's safe import).

What is not there yet is said in the menu instead of offered: clone, snapshots, add-ons and extra domains.

## Podman

Podman runs the same `compose.yaml` as Docker, through `podman compose`, without a daemon and without root. Two things are its own:

- **Its socket must be running:** `systemctl --user start podman.socket` (add `enable` to keep it across restarts). `podman compose` hands the file to the Compose plugin, which talks to that socket.
- **The web service keeps your user:** its compose file sets `userns_mode: keep-id`, so the site's files belong to you, and it starts as root inside the container so Apache can listen on port 80.

Proven on Podman 4.9.3, rootless: Drupal 11 built and installed, its pages answering, Drush working, and the database exported and imported back. The dashboard's row and tools on a Podman site use the same code as Docker and have not been run on a real Podman yet.

## Lando

A Lando site is a `.lando.yml` the Workspace writes: Lando's `lamp` recipe (Apache, PHP and MariaDB, with the docroot and the versions the build asks for), Mailpit, WP-CLI, and the database `db`, user `db`, password `db`, which also answers on the host `db` as on the other runtimes. Nothing in `~/.lando` is changed. Three things are its own:

- **Lando's proxy stays off.** Every call the Workspace makes runs with `LANDO_PROXY=OFF`: the proxy would ask for ports 80 and 443, which DDEV's router holds. The site answers on a port of this machine instead (`127.0.0.1`), as on Docker Compose, and so does its mailbox. `LANDO_CHANNEL=none` keeps Lando's update notices out of what a build reads.
- **A first start can be slow.** A database made for the first time can take longer than Lando's healthcheck waits for; Lando then says it failed although the app runs. The Workspace asks the database itself, for up to three minutes, before it counts the start as failed.
- **A `.lando.yml` of your own** (one the Workspace did not write) is a Lando project too: `ddev drush`, `ddev composer`, `ddev export-db` and the rest run in it through Lando, and `ddev config` leaves the file as it is. Its row keeps the LANDO menu of the Lando plugin.

Proven on Lando v3.26.9: Drupal 11 built and installed, its pages and a login to the administration, Drush, the test users added and cancelled, the webship-js suite in the tests container, a mail caught by Mailpit, the database exported and imported back, the row in the dashboard (state, link, menus, stop and start, the Tests menu, a backup), a remove and a restore from the Backups page; and the same for a WordPress site of the WordPress plugin.

## Docksal

A Docksal site is a `.docksal/` folder the Workspace writes: Docksal's default stack (Apache in `web`, PHP with Composer and WP-CLI in `cli`, MariaDB in `db`), with the docroot, PHP (`docksal/cli:php<version>-3.10`, 8.1 to 8.4) and MariaDB the build asks for, the database `db`, user `db`, password `db` on the host `db`, and Docksal's mail service (Mailpit). Nothing in `~/.docksal` is changed. What is its own:

- **The address is a host name:** `http://<name>.docksal.site`, answered by Docksal's proxy (on its own address, `192.168.64.100`, not DDEV's `127.0.0.1`). The mailbox is `http://mail.<name>.docksal.site`, and the tests container reaches both.
- **PHP runs in `cli`.** DDEV's `web` is Docksal's `cli`: `ddev exec`, `ddev composer`, `ddev drush` and `ddev wp` run there, as Docksal's user (yours); `ddev exec -s db` runs in `db`.
- **Commands go through `docker exec -i`** on the project's container: `fin exec` gives a command no stdin, and an import is a dump piped in. Starting, stopping, `ssh` (`fin bash`) and removing go through `fin`.
- **A `.docksal/` of your own** (one the Workspace did not write) is a Docksal project too, after `.ddev/` and a `.lando.yml`; `ddev config` leaves it as it is, and its row keeps the DOCKSAL menu of the Docksal plugin. The home folder is never one: `~/.docksal` is Docksal's own settings. Nor is `/tmp`: `/tmp/.docksal` is Docksal's too, a folder per project for its ssh-agent socket.

Proven on Docksal 1.19.0 (fin 1.118.0): the same list as Lando's above, for a Drupal 11 site and a WordPress site.

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

Both use one image, `core/docker/Dockerfile`: Node.js 26, git, screen, Python, pandoc, the Docker client with the compose plugin, kubectl, kind and the Claude Code CLI. The app is not in the image. The workspace is mounted at the same path it has on the host, because the dashboard builds sites through the host's Docker, and the Docker daemon reads a site's folder on the host.

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

The builders and the tools keep calling DDEV's commands (`ddev config`, `ddev start`, `ddev composer`, `ddev drush`, `ddev exec`, `ddev export-db`). On a DDEV project those are DDEV itself. On another runtime, `core/scripts/functions/fun-runtime.sh` gives each command its meaning there: `docker compose`, `podman compose`, `kubectl`, `lando` or `fin`. So a builder written for DDEV works on the others without a change, as long as it uses those commands.

The work is tracked in [webship/workspace#694](https://github.com/webship/workspace/issues/694).
