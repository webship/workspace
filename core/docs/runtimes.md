# Runtimes: DDEV, Docker, Podman and Kubernetes

The Webship Workspace is container-based. A site you build runs on a container runtime, and DDEV is the default. A builder can also build on Docker Compose, on Podman or on a Kubernetes cluster.

This page says what works today. It is updated as each part is proven on a real build.

## What works where

| | DDEV | Docker Compose | Kubernetes | Podman |
|---|---|---|---|---|
| Build and install a Drupal site (the core's Drupal-family builders) | Yes | Yes | Yes | Yes, not yet run on a real Podman |
| Composer, Drush and commands in the site | Yes | Yes | Yes | The same commands as Docker |
| Export and import the database | Yes | Yes | Yes | The same commands as Docker |
| The site's row in the dashboard: state, link, menus | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman |
| The Tests menu, test users, backup, restore and remove | Yes | Yes | Yes | The same code as Docker, not yet run on a real Podman |
| Clone, import a database from the menu, snapshots, add-ons, extra domains, captured mail | Yes | On the way | On the way | On the way |
| The platform plugins' builders (WordPress, Laravel, …) | Yes | On the way | On the way | On the way |
| The dashboard itself | Yes | On the way | On the way | On the way |

Lando and Docksal are planned next. Today their plugins add a menu to a project that already has a `.lando.yml` or a `.docksal/` folder.

"Yes" means it was run on a real build: Drupal 11 built and installed, its front and login pages answering, `drush status` bootstrapping, and the database exported and imported back. For the dashboard rows it means a real site driven in a browser: the row, the menu, stop and start, the tests set up and run, the test users added and cancelled, a backup, a remove and a restore.

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
- **Docker Compose and Podman:** `compose.yaml`, with an `x-webship:` block (the runtime, the PHP and database versions, the port), and `.webship/runtime/Dockerfile`, the image of its web service. You can run it without the Workspace: `docker compose up -d`.
- **Kubernetes:** the same `compose.yaml`, plus `k8s/` (a `kustomization.yaml` and the manifests: a namespace `ws-<name>`, Deployments and Services for the web, the database and the mail catcher, a volume claim for the database). You can apply it yourself: `kubectl apply -k k8s`.

Each has a web service (Apache and PHP with Composer), a MariaDB database and a Mailpit mail catcher.

## In the dashboard

A site on Docker Compose, Podman or Kubernetes has the row a DDEV project has. Its card shows **Running** or **Stopped** (the chip is the switch), links to the site's own address, and carries a **DOCKER**, **PODMAN** or **K8S** menu where the DDEV menu sits: start, stop, restart, describe, the web logs, a shell in the web container, export the database, back up, delete the containers (or the namespace) and remove the project. Each entry runs as a screen session, like the DDEV menu's.

- **Composer** runs in the site's own web container.
- **Tests** sets up and runs the site's webship-js suite. The web image has no Node.js, so the suite runs in a tests container beside the site: one image the Workspace builds once (Node.js 24 and the libraries Playwright's browsers need), on the host's network, against the site's address. The browsers are kept in one volume every project shares, `webship-workspace-tests`. **Node** runs there too.
- **Test users**, **backup**, **restore** from the Backups page and **remove** work as on DDEV. Remove takes the runtime's side down first (the containers and the database volume, or the namespace), then the image built for the site, then the folder.
- The state is read from `docker compose ls`, `podman ps` and `kubectl get deploy`, each with a timeout. A runtime that does not answer shows **unknown**, and the page does not wait for it.

What is not there yet is said in the menu instead of offered: clone, importing a database, snapshots, add-ons, extra domains and captured mail.

## Which cluster

A Kubernetes build goes to the context named in `WORKSPACE_KUBE_CONTEXT`.

With none set, the Workspace uses a local [kind](https://kind.sigs.k8s.io/) cluster named `webship`, and creates it on the first build, with your home folder mounted into its node so the pods see the code where it is. This needs `kind` and `kubectl` installed. A project must live under your home folder for that.

On a cluster of your own, the web image must be one the cluster can pull, and the code must be reachable by its nodes: the manifests mount the project folder from the node.

## How it works

The builders and the tools keep calling DDEV's commands (`ddev config`, `ddev start`, `ddev composer`, `ddev drush`, `ddev exec`, `ddev export-db`). On a DDEV project those are DDEV itself. On another runtime, `core/scripts/functions/fun-runtime.sh` gives each command its meaning there: `docker compose`, `podman compose` or `kubectl`. So a builder written for DDEV works on the others without a change, as long as it uses those commands.

The work is tracked in [webship/workspace#694](https://github.com/webship/workspace/issues/694).
