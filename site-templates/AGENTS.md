# Site templates

Drupal CMS sites built from a **site template** — a `Site` recipe that decides what the site is
before you have written anything: its content types, its editorial workflow, its front end.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

## What a site template is

A [site template](https://new.drupal.org/browse/site-templates) is a Composer package of type
`drupal-recipe`. The browser installer normally asks which one you want; these builders answer
that question non-interactively:

```
installer_site_template_form.add_ons=<recipe directory name>
```

The recipe directory name is the package name without its vendor prefix — where Composer puts a
`drupal-recipe`. So `drupal/byte` installs as `byte`.

**Website Starter** is the reference template here: the one to copy when starting a new one, and
the one to check a change against.

## The rule that matters here

Everything goes through DDEV. Never a host `composer`, `drush` or `mysql`:

```bash
ddev composer require drupal/something
ddev drush cr
ddev export-db --file=…        # not mysqldump
ddev delete -y -O              # not a dropped database
```

`ddev start` takes `-y`; **`ddev stop` does not**. Never write a `$databases` block into
`settings.php` — DDEV's `settings.ddev.php` owns the connection.

## Building one

```bash
bash cmd-website_starter-project.sh mysite                              # build and install
bash cmd-byte-project.sh mysite --skip-install                          # codebase only, pick it in the installer
bash cmd-haven-project.sh mysite --site-template-version "^1.0"         # pin the template
bash cmd-summit-project.sh mysite --require drupal/token drupal/ctools  # extra packages
bash cmd-local-project.sh mysite --launch                               # open it when it is ready
```

`--help` on any of them lists its arguments.

## Commands here

```bash
bash cmd-website_starter-project.sh                    # Website Starter (Webship site template)
bash cmd-archimedes-project.sh                         # Archimedes (Drupal CMS site template)
bash cmd-byte-project.sh                               # Byte (Drupal CMS site template)
bash cmd-caresphere-project.sh                         # CareSphere (Drupal CMS site template)
bash cmd-convene-project.sh                            # Convene (Drupal CMS site template)
bash cmd-convivial_gov-project.sh                      # Convivial Gov (Drupal CMS site template)
bash cmd-everbright-project.sh                         # Everbright (Drupal CMS site template)
bash cmd-forma-project.sh                              # Forma (Drupal CMS site template)
bash cmd-haven-project.sh                              # Haven (Drupal CMS site template)
bash cmd-healthcare-project.sh                         # Healthcare (Drupal CMS site template)
bash cmd-local-project.sh                              # Local (Drupal CMS site template)
bash cmd-lupus_decoupled_starter-project.sh            # Nuxt Starter (Drupal CMS site template)
bash cmd-mercury_demo-project.sh                       # Mercury Demo (Drupal CMS site template)
bash cmd-provus_edu-project.sh                         # Provus EDU (Drupal CMS site template)
bash cmd-pulse-project.sh                              # Pulse (Drupal CMS site template)
bash cmd-summit-project.sh                             # Summit (Drupal CMS site template)
bash cmd-tools-graphify.sh                             # Map a project in this workspace into a queryable knowledge graph
bash cmd-tools-obsidian.sh                             # Turn a project graph into an Obsidian vault
bash cmd-tools-ragify.sh                               # Index a project in this workspace into the Milvus vector database
bash cmd-tools-remove.sh                               # Remove a project and its DDEV environment
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install.

## Not here

The curated list carries one **paid** template (Meridian Charter, `dripyard/…`), which needs a
licence key at install time. It has no builder here — add one the same shape if you buy it.
