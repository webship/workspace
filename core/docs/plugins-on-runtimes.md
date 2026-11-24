# A platform plugin on Docker Compose and Kubernetes, not only DDEV

The Webship Workspace is container-based (DDEV by default). A site can also be built on Docker Compose, on Podman, on a Kubernetes cluster, on Lando or on Docksal: `--runtime docker|podman|kubernetes|lando|docksal` on its builder. This page says what a platform plugin (`@webship.co/workspace-<p>`) changes to build there, and how to prove it. It is written from the reference plugin, `@webship.co/workspace-wordpress`, where every line below was run on real sites. `<p>` is the plugin's name, `<P>` the platform's written name.

It fits a platform on **PHP, Apache and MariaDB** as it is (the `php` stack), and an application in **another language** (Python, Node.js, Java, .NET, Ruby, Go, or an image of its own) with **PostgreSQL**, **MariaDB** or no database: see "An application in another language" (webship/workspace#841). What does not fit yet is at the end.

## How it works

- **The builder keeps calling `ddev <verb>`.** On a DDEV project that is DDEV itself. On another runtime the core's layer (`core/scripts/functions/fun-runtime.sh`) gives the verb its meaning: `docker compose`, `podman compose` or `kubectl`. So most of a builder needs no change.
- **A project's runtime is what its folder carries:** `.ddev/config.yaml` is DDEV; a `compose.yaml` with an `x-webship:` block is the runtime the block names (Kubernetes adds `k8s/`). `ddev config` writes those files, so it must be the first `ddev` call of a build, in the project folder.
- **A new build** takes `--runtime` (the variable `RUNTIME`), else `WORKSPACE_RUNTIME`, else `container.runtime` in `settings.yml`, else DDEV.

The verbs the layer knows:

| Verb | On Docker Compose and Kubernetes |
| --- | --- |
| `ddev config --project-type=<t> --docroot=<d> --project-name=<n> [--php-version=<v>] [--database=mariadb:<v>] --auto` | Writes `compose.yaml` (and `k8s/`) and `.webship/runtime/Dockerfile`. Other flags are ignored. A second call keeps the port and the claim |
| `ddev start`, `restart`, `stop`, `delete -y -O`, `describe`, `describe -j`, `logs`, `launch` | The same meaning. `launch` prints the address |
| `ddev composer …` | Composer in the web container. `create-project <pkg>` and `create-project <pkg> .` make the project in the project root, as on DDEV, in a folder that already holds the runtime's files; `create-project <pkg> <folder>` makes it in that folder, as Composer does |
| `ddev php …`, `ddev wp …`, `ddev drush …` | In the web container, as the site's user, in the folder the builder is in. What is piped in reaches the command |
| `ddev exec "<command line>"`, `ddev exec -s db …`, `ddev exec -d <dir> …` | `bash -c` in the web (or db) container |
| `ddev npm`, `npx`, `node`, `yarn`, `ddev exec -s tests …` | In the tests container (Node.js 26), not in the web container |
| `ddev mysql`, `ddev export-db --file=<f>`, `ddev import-db --file=<f>` | The MariaDB of the project |
| `ddev add-on`, `get`, `snapshot`, `xdebug`, `share`, `auth` | Nothing: a line says so, and the build goes on |
| Anything else (`ddev artisan`, `ddev dotenv`, `ddev craft`, `ddev typo3`, `ddev magento`, `ddev console`) | **Fails**, with a message. Call it through `ddev exec` instead, which works on DDEV too: `ddev exec "php artisan migrate --force"` |

The stack a project gets (the `php` stack, `core/config/runtimes/php/Dockerfile`):

| | |
| --- | --- |
| Web | Apache with `mod_rewrite` and `AllowOverride All`, the docroot from `--docroot`. Not nginx |
| PHP | 8.3 by default (`--php-version`), with gd, pdo_mysql, mysqli, zip, intl, opcache, bcmath, exif; `memory_limit` 1G |
| Tools in the web container | Composer 2, WP-CLI, git, unzip, curl, patch, the MariaDB client. No Node.js |
| Database | MariaDB 10.11 by default (`--database=mariadb:<v>`), on the host `db`, port 3306: database `db`, user `db`, password `db`, root password `root` |
| Mail | Mailpit on the host `mail`. PHP's `mail()` goes there. An app that speaks SMTP uses `mail`, port 1025, no login |
| Files | The project folder at `/var/www/html`, written as your own user |
| Address | Docker Compose and Podman: `http://127.0.0.1:<port>`, a free port kept in `compose.yaml`. Kubernetes: `http://<node address>:<NodePort>`. Plain HTTP, no host name. The site reaches itself there from inside its container |

On Lando the same values hold in its own containers (Lando's `lamp` recipe): the database `db`/`db`/`db` on the host `db` (Lando's `database` service, with `db` as a second name), Mailpit (Lando's `mailpit` service: read its address with `rt_mail_url`, not `http://mail:8025`), the project at `/app` instead of `/var/www/html`, and the address `http://127.0.0.1:<port>` kept in `.lando.yml`.

On Docksal: PHP runs in the `cli` container (DDEV's `web`), the project is at `/var/www`, the database `db`/`db`/`db` on the host `db`, Mailpit on the host `mail`, and the address is `http://<name>.docksal.site` (read it with `rt_url`, the mailbox with `rt_mail_url`).

## What to change

1. **`--runtime` in the builder's arguments** (`scripts/args/arg-<p>.sh`), exactly as the core's builders have it:

   ```python
   parser.add_argument('--runtime',
                       dest='RUNTIME',
                       default="_none_",
                       choices=['ddev', 'docker', 'podman', 'kubernetes', 'lando', 'docksal'],
                       help='The container runtime to build on: ddev (the default, or container.runtime of settings.yml), docker (Docker Compose), podman, kubernetes, lando or docksal.')
   ```

2. **Three small functions** in `scripts/functions/fun-<p>.sh`. Each works on a core that has no runtime layer yet, where the answer is DDEV:

   ```bash
   function <p>_runtime() { if declare -f runtime_of > /dev/null ; then runtime_of ; else echo 'ddev' ; fi ; }
   function <p>_url() { if declare -f rt_url > /dev/null ; then rt_url ; else echo "https://${PROJECT_NAME}.ddev.site" ; fi ; }
   function <p>_is_project() {
     local project_path="$1";
     if declare -f rt_is_platform > /dev/null ; then rt_is_platform "${project_path}" <p> ; return $? ; fi
     grep -qE '^type:[[:space:]]*"?<type>"?[[:space:]]*$' "${project_path}/.ddev/config.yaml" 2>/dev/null ;
   }
   ```

   Use `<p>_is_project` everywhere a function reads `.ddev/config.yaml` to know the project: the CLI tool, the user functions, `testing_configure_<p>`. A platform that is also recognised by a file (`app/Config/Paths.php`, `artisan`) keeps that check beside it.

3. **In the build function, refuse a `--runtime` the workspace cannot give,** before anything is created:

   ```bash
   local base_url runtime ;
   runtime="$(<p>_runtime)" ;
   if [ "${RUNTIME:-_none_}" != '_none_' ] && [ "${RUNTIME}" != "${runtime}" ] ; then
     echo "--runtime ${RUNTIME} needs a Webship Workspace with the container runtimes (webship/workspace#694): update the workspace, or build on DDEV." ;
     exit 1 ;
   fi
   ```

4. **The address comes from the runtime, after `ddev config`.** Replace every written `https://${PROJECT_NAME}.ddev.site`: the install's `--url`, an `APP_URL` in `.env`, what the build and the tool print.

   ```bash
   ddev config --project-type=<type> --docroot="${distribution_webroot}" --project-name=${PROJECT_NAME} … --auto || exit 1 ;
   ddev_up start -y || exit 1 ;
   base_url="$(<p>_url)" ;
   ```

5. **The claim.** The dashboard finds the plugin's user list (the row's **Add the test users**) from the project.
   - The project type is the platform's own (`wordpress`, `laravel`, `typo3`, `craftcms`, `backdrop`, `magento2`, `symfony`): nothing to do. The type is kept in `compose.yaml`.
   - The type is `php` or `generic`, or another platform's (a shop on `wordpress`): call `rt_claim <p>` after `ddev config`. It writes `platform: <p>` in the `x-webship:` block, which is on a runtime what `.ddev/config.<p>.yaml` is on DDEV. On a DDEV project it does nothing: keep writing your own file there.

     ```bash
     declare -f rt_claim > /dev/null && rt_claim <p> ;
     ```

6. **Write the config file DDEV writes for the platform, and the runtime does not.** Only when the runtime is not DDEV, only when the file is not there, with the stack's own values and nothing personal:

   ```bash
   if [ "${runtime}" != 'ddev' ] ; then
     <p>_runtime_config || { echo "<the file> could not be written." ; exit 1 ; } ;
   fi
   ```

   The WordPress row was run on real sites. The others say where to look, and each is proven by its own plugin:

   | Platform | DDEV writes | On a runtime the plugin writes |
   | --- | --- | --- |
   | WordPress | `wp-config.php`, `wp-config-ddev.php` | `ddev wp config create --dbname=db --dbuser=db --dbpass=db --dbhost=db --skip-check` |
   | Laravel, Symfony | `DB_*` in `.env`, `.env.local` | The same keys: `DB_CONNECTION=mariadb`, `DB_HOST=db`, `DB_PORT=3306`, `DB_DATABASE=db`, `DB_USERNAME=db`, `DB_PASSWORD=db`, and `MAIL_HOST=mail`, `MAIL_PORT=1025` |
   | TYPO3, Craft CMS, Backdrop CMS, Magento | `AdditionalConfiguration.php`, `.env`, `settings.ddev.php`, `env.php` | The same values, in the file the platform reads |
   | An installer that asks (Joomla, phpBB, MediaWiki, Moodle, PrestaShop) | Nothing: the builder already passes the values | Nothing new: host `db`, database `db`, user `db`, password `db` are the same on every runtime |
   | Drupal | `settings.ddev.php` | Nothing: the layer writes `settings.webship-runtime.php` |

7. **Apache, not nginx.** DDEV serves each project type with an nginx configuration of its own. The `php` stack is Apache, so the platform's rewrite rules must be in an `.htaccess` in the docroot. Most platforms ship one. Where the platform writes it itself only from its admin pages (WordPress), the builder writes the platform's standard file when there is none, on a runtime only.

8. **The site reaches itself at its own address** on each runtime, as on DDEV: on Docker Compose and Podman the web container also answers on the site's port, and on Kubernetes a pod reaches the node. So what a platform does by calling itself works: scheduled tasks, its own health checks, an install that tries its clean addresses. Two things to do all the same:
   - Where an install step decides something by calling the site, and a wrong answer would change the site, set the result when it is missing, on a runtime only:

     ```bash
     if [ "${runtime}" != 'ddev' ] && [ -z "$(ddev wp option get permalink_structure 2>/dev/null)" ] ; then
       ddev wp rewrite structure '/%year%/%monthnum%/%day%/%postname%/' ;
     fi
     ```

   - Where the platform keeps its address in the database or in a file, let it answer at the address it is asked on, when it can (WordPress: `WP_HOME` and `WP_SITEURL` from `$_SERVER['HTTP_HOST']`, in the `wp-config.php` the builder writes on a runtime). The same site then answers on its port, on a node of a cluster and through a tunnel.

9. **The testing hook** (`testing_configure_<p>`) needs only `<p>_is_project` from step 2. `cmd-tools-testing.sh` is the core's: on a runtime it runs the suite in the tests container and hands it the site's address as `LAUNCH_URL`. Never write an address into `cucumber.js`; read `process.env.LAUNCH_URL`.

10. **The words.** The file header, `--help`, the README and the assistant's context say "container-based (DDEV by default)" and name the runtimes. No sentence says a site is only at `ddev.site`.

### PHP settings of the project's own, and a task beside the web server

A platform that needs PHP settings of its own (Moodle's `max_input_vars`), or a task that keeps running beside the web server (a cron loop, a queue worker), says so through the layer, after `ddev config` and before the first start, on every runtime (webship/workspace#825):

```bash
printf 'max_input_vars = 5000\n' | rt_php_ini moodle            # the settings, read on the input
rt_daemon cron "bash /var/www/html/.webship/moodle-cron.sh"      # a name, and the command that keeps running
```

| | DDEV | Docker Compose, Podman | Kubernetes | Lando | Docksal |
| --- | --- | --- | --- | --- | --- |
| `rt_php_ini <name>` | `.ddev/php/<name>.ini`, DDEV's own folder | `.webship/php/<name>.ini` | the same | the same | the same |
| Read by | DDEV | the web container (`PHP_INI_SCAN_DIR`), for Apache and the command line, after the stack's own settings | the web pod, the same | the appserver, the same | `cli`, where PHP runs, the same; for php-fpm also a pool file of the project's, read before Docksal's own pool settings (`.webship/runtime/docksal-fpm.conf`), which would win over ini files |
| `rt_daemon <name> <command>` | `.ddev/config.daemon-<name>.yaml` (`web_extra_daemons`) | `.webship/daemons/<name>.sh`, declared in the `x-webship` block (`daemons:`); the project's `daemons` service runs every task as the web server's user, with the web service's image, code and settings | the same script; a second container of the web pod, `daemons` | the same script; the appserver runs the tasks after each start (`events: post-start`), once, as the web server's user | the same script; a program of `cli`'s supervisor, where PHP runs, as the project's user |

A task is a command that does not end (a loop, a worker); its folder is the project's root in the container. The settings are read when PHP starts: written after a start, they need `ddev restart`. A builder that keeps its own DDEV files can call the two helpers on the other runtimes only, so its DDEV build stays what it was.

## What never to do

- Never call `docker`, `docker compose`, `podman` or `kubectl` from a plugin, and never `command ddev`. Only `ddev <verb>`: the layer chooses.
- Never write `ddev.site`, `127.0.0.1` or a port into a file of the site, a test or a message. Ask `<p>_url`.
- Never change what the builder does on DDEV. Every new line sits behind `[ "${runtime}" != 'ddev' ]`, or is a function that answers as before there.
- Never write database settings on DDEV: its own file owns them.
- Never write a value that is a person's. The database is `db`/`db`/`db`, accounts are `@example.com`, the administrator is the workspace account.
- Never call a verb the layer does not know (`ddev artisan`, `ddev dotenv`): use `ddev exec`.
- Never run npm or node with `ddev exec` in the web container on a runtime: it has no Node.js. Use `ddev npm`, `ddev npx`, `ddev node`.
- Never name a runtime "supported" in the README before the checklist below is green on it.

## Tests

- **Unit tests** in the plugin's own style, with `ddev` replaced by a recorder:
  - on DDEV the build runs the same commands as before, to the letter, on a core with the layer and on one without;
  - on `docker`, `podman` and `kubernetes` it writes the config file with `db`/`db`/`db`, installs at the runtime's address and prints no `ddev.site`;
  - a config file that is already there is kept;
  - `--runtime` on a core without the layer is refused and nothing is started;
  - `<p>_is_project` asks `rt_is_platform`.
- **A webship-js feature**, `features/<p>-runtimes.feature`, listed in the manifest's `features`. Its scenarios are tagged `@needs-runtime-docker @needs-platform-<p>` (and `@needs-runtime-kubernetes @needs-platform-<p>`): they drive the first running site of that runtime and platform in the workspace, and are skipped with the reason where there is none. The core's steps: the row shows "Running", links to the address of its runtime, carries the "DOCKER" or "K8S" menu and no DDEV menu, the Tests menu offers "Add the test users", and `When I open "/a-path" on the "docker" site` for a page of the site.
- **One real site in CI:** `"featuresSite": "cmd-<p>-project.sh ci-<p> --install --add-users --runtime docker"` in the manifest's `workspacePlugin`. The reusable workflow `plugin-browser-suite.yml` builds it on Docker Compose before the features, so the Docker scenarios are real in every pull request. Kubernetes scenarios run where a cluster is.

## The checklist to prove it

In a throwaway workspace under your home folder (a kind cluster mounts `/home` only), with the plugin required from its folder or an `npm pack` tarball. Once per runtime: `--runtime docker`, `--runtime kubernetes`, and DDEV to show nothing changed. One site at a time, removed when done.

1. `bash cmd-<p>-project.sh <name> --install --add-users --runtime <runtime>` ends with the site's address and exit code 0.
2. The front page answers 200 at that address, and the workspace account logs in to the administration.
3. `bash cmd-tools-<p>-cli.sh <name>` says the version and the address; `--run "<a command>"` runs.
4. `bash cmd-tools-cancel-users.sh <name> <p>` removes the default accounts; `bash cmd-tools-add-users.sh <name> <p>` adds them.
5. A mail the site sends is in Mailpit.
6. `bash cmd-tools-testing.sh <name>` sets the suite up; `--run` is green: every scenario, with the count written down.
7. The database is exported, a value is changed, the export is imported, and the value is back.
8. In the dashboard: the row shows Running, links to the address, carries the runtime's menu (DOCKER, K8S) or the DDEV menu; the Tests menu adds and cancels the test users; stop and start change the state; a backup is made.
9. Remove the project: the containers and the volume, or the namespace, the image and the folder are gone.
10. The plugin's `npm run lint` and `npm test` pass, and its webship-js feature passes against that workspace's dashboard with the site running.

Keep the logs. Write down the numbers: the seconds of each build, the scenarios and steps of each run.

## An application in another language

An application that serves itself (Django, Next.js, Spring Boot, ASP.NET Core, …) builds on DDEV as a generic project: `ddev config --project-type=generic --webserver-type=generic`, a `.ddev/web-build/Dockerfile.<name>` with its language, its server as a `web_extra_daemons` entry and `web_extra_exposed_ports` to its port. On another runtime its builder keeps that `ddev config` and says three more things after it, before the first start (webship/workspace#841):

```bash
ddev config --project-type=generic --webserver-type=generic --database=postgres:16 --project-name=<name>
rt_stack python 3.13                                 # the language and the version the application chooses (never latest)
rt_web_build uv <<'EOF'                              # what it adds to the stack's image, a Dockerfile fragment
RUN pip install --no-cache-dir uv==0.13.7
EOF
rt_serve 8000 '.venv/bin/python mysite/manage.py runserver 0.0.0.0:8000'   # its own server, and the port it listens on
```

| | What the layer does |
| --- | --- |
| `--webserver-type=generic` | A generic stack: no Apache, no PHP. The web image is the language's own (`core/config/runtimes/generic/Dockerfile`) with git, curl, the clients of MariaDB and PostgreSQL, msmtp as `sendmail` to the stack's Mailpit, and `www-data` as the host user |
| `rt_stack <language> <version>` | `python` → `python:<v>-slim-bookworm`, `node` → `node:<v>-bookworm-slim`, `java` → `eclipse-temurin:<v>-jdk`, `dotnet` → `mcr.microsoft.com/dotnet/sdk:<v>`, `ruby` → `ruby:<v>-slim-bookworm`, `go` → `golang:<v>-bookworm`; `image <name>:<tag>` (or `<name>@sha256:…`, never `latest`) for an image of the application's own, on a Debian, Ubuntu or Alpine base: the stack adds its layer with a shell and `apt-get` or `apk`, so `rt_stack` runs the image once to see which it has, and refuses an image with neither, or with no shell (a distroless one), before anything is written. The version is the application's: read it from its own files where it has one (`.python-version`, `.nvmrc`, `engines`), never the Workspace's Node.js floor |
| `rt_web_build <name>` | `.webship/runtime/web-build/Dockerfile.<name>`, added to the image after the stack's own |
| `rt_serve <port> <command>` | `.webship/runtime/serve.sh`, which the web container runs as the host user from the project's root; the project's address goes to that port (Docker Compose and Podman: `127.0.0.1:<port>:<serve port>`; Kubernetes: the NodePort's `targetPort`) |
| `--database=postgres:<v>` | `postgres:<v>` as the `db` service (`db`/`db`/`db`, its data where its version keeps it); `ddev psql`, and `export-db` / `import-db` with `pg_dump` and `psql`. The PostgreSQL plugin reads the block's `database: "postgres:<v>"` |
| `--omit-containers=db` | No database |

The three calls are kept in the `x-webship` block (`stack: generic`, `language`, `language_version`, `serve_port`), so they stay when the files are written again; on DDEV they do nothing, and the plugin's own `.ddev` files are DDEV's way. A PostgreSQL import is checked before anything is touched: the dump is read and must be PostgreSQL's and whole (pg_dump's own last line, `-- PostgreSQL database dump complete`, at its end), the client and the database are asked separately, the dump goes into a database of its own, and only a whole import takes the place of `db`. During that swap `db` takes no connection (`ALLOW_CONNECTIONS false`), so an application's server, a pool above all, cannot connect again between the closing of its connections and the rename; on any failure `db` is put back as it was, open again. Anything short of a whole import fails, and says so, with the project's database as it was. Removing a project removes what it built (its containers, its volume, its image), never the language's base image. So far on Docker Compose, Podman and Kubernetes; Lando and Docksal follow.

## What does not fit yet

- **MySQL 8 as a project's database**, and PostgreSQL on Lando and Docksal (SQLite in a file is fine): the layer renders MariaDB and, on Docker Compose, Podman and Kubernetes, PostgreSQL.
- **A service of the platform's own** (OpenSearch for Magento, Redis, a database's web admin such as Adminer): a DDEV add-on or a `docker-compose.<name>.yaml` in `.ddev/` has no equivalent yet. PHP settings of the project's own and a task in the web container's image (a cron loop, a queue worker) do fit: `rt_php_ini` and `rt_daemon` above.
- **An application in another language on Lando or Docksal:** the generic stack renders on Docker Compose, Podman and Kubernetes so far; on Lando and Docksal it builds on DDEV only, until #841's next step.

A builder that does not fit yet must not build a `php` stack by accident, when the workspace's `container.runtime` names another runtime. It says so and stops, before `ddev config`:

```bash
if [ "$(<p>_runtime)" != 'ddev' ] ; then
  echo "<P> builds on DDEV only for now: its stack is not on the other runtimes yet (webship/workspace#694). Build with --runtime ddev." ;
  exit 1 ;
fi
```

Such a builder takes `--runtime` with the one choice `ddev`, so that line can be followed.
- **Captured mail in a browser:** Mailpit has a port of its own on a runtime (`mail_port` in `compose.yaml`: a port of this machine, or a NodePort), and the tests container hands a suite its address as `MAIL_URL`. The dashboard has no page for it yet.
- **HTTPS and a host name:** a runtime's address is plain HTTP on a port.
