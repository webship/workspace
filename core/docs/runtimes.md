# Runtimes: DDEV, Docker, Podman and Kubernetes

The Webship Workspace is container-based. A site you build runs on a container runtime, and DDEV is the default. A builder can also build on Docker Compose, on Podman or on a Kubernetes cluster.

This page says what works today. It is updated as each part is proven on a real build.

## What works where

| | DDEV | Docker Compose | Kubernetes | Podman |
|---|---|---|---|---|
| Build and install a Drupal site (the core's Drupal-family builders) | Yes | Yes | Yes | Yes, not yet run on a real Podman |
| Composer, Drush and commands in the site | Yes | Yes | Yes | The same commands as Docker |
| Export and import the database | Yes | Yes | Yes | The same commands as Docker |
| The site's row in the dashboard: state, link, menus | Yes | On the way | On the way | On the way |
| The Tests menu, test users, backups | Yes | On the way | On the way | On the way |
| The platform plugins' builders (WordPress, Laravel, …) | Yes | On the way | On the way | On the way |
| The dashboard itself | Yes | On the way | On the way | On the way |

Lando and Docksal are planned next. Today their plugins add a menu to a project that already has a `.lando.yml` or a `.docksal/` folder.

"Yes" means it was run on a real build: Drupal 11 built and installed, its front and login pages answering, `drush status` bootstrapping, and the database exported and imported back.

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

## Which cluster

A Kubernetes build goes to the context named in `WORKSPACE_KUBE_CONTEXT`.

With none set, the Workspace uses a local [kind](https://kind.sigs.k8s.io/) cluster named `webship`, and creates it on the first build, with your home folder mounted into its node so the pods see the code where it is. This needs `kind` and `kubectl` installed. A project must live under your home folder for that.

On a cluster of your own, the web image must be one the cluster can pull, and the code must be reachable by its nodes: the manifests mount the project folder from the node.

## How it works

The builders and the tools keep calling DDEV's commands (`ddev config`, `ddev start`, `ddev composer`, `ddev drush`, `ddev exec`, `ddev export-db`). On a DDEV project those are DDEV itself. On another runtime, `core/scripts/functions/fun-runtime.sh` gives each command its meaning there: `docker compose`, `podman compose` or `kubectl`. So a builder written for DDEV works on the others without a change, as long as it uses those commands.

The work is tracked in [webship/workspace#694](https://github.com/webship/workspace/issues/694).
