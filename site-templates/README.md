# Site templates.
--

Every free Drupal CMS site template, from both places that list them:
https://new.drupal.org/browse/site-templates, and the installer's own curated list at
https://git.drupalcode.org/project/drupal_cms_installer/-/blob/HEAD/site-templates.yml.

The two disagree, which is why both are read. `dashi` is browsable but not in the
installer's list; `forma` and `lupus_decoupled_starter` are in the installer's list with
no browse page. This folder carries the union, free only.

A site template is a `Site` recipe: Drupal CMS asks which one to use during
installation. Each `cmd-<name>-project.sh` here builds Drupal CMS; with `--install` it
also answers that installer step for you:

```
cd ~/workspace/site-templates
bash cmd-healthcare-project.sh healthcare1 --install
```

When it finishes, the site is installed and reachable at both

```
https://healthcare1.site-templates.workspace.ddev.site
https://healthcare1.ddev.site
```

Without `--install` the build stops at `/core/install.php`, where you pick the template.
For a template the installer lists, that is all it takes — the installer downloads the
recipe itself, so the build is the plain `composer create-project drupal/cms` the project
page publishes. For one it does not list, the builder requires the package first, on every
path. Each script says which it is, next to `site_template_listed`.

Each builder states the release line it tracks — `^1` for almost all of them, `^2` for
Nuxt Starter — in its name and in `site_template_version`. An unconstrained require takes
whatever is newest, so without it the same command would build a different major the day
one ships. `--site-template-version` overrides it.

Options: `--site-template-version` (default: latest), `--php-version` (8.4),
`--install`, `--launch`, `--require`. `bash cmd-<name>-project.sh --help` lists them.

| Command | Site template | Package | In the installer's list |
| --- | --- | --- | --- |
| `cmd-archimedes-project.sh` | Archimedes | `drupal/archimedes` | yes |
| `cmd-byte-project.sh` | Byte | `drupal/byte` | yes |
| `cmd-caresphere-project.sh` | CareSphere | `drupal/caresphere` | yes |
| `cmd-convene-project.sh` | Convene | `drupal/convene` | yes |
| `cmd-convivial_gov-project.sh` | Convivial Gov | `drupal/convivial_gov` | yes |
| `cmd-dashi-project.sh` | Dashi | `drupal/dashi` | **no** — always required |
| `cmd-everbright-project.sh` | Everbright | `drupal/everbright` | yes |
| `cmd-forma-project.sh` | Forma | `drupal/forma` | yes (no browse page) |
| `cmd-goodwell-project.sh` | Goodwell | `drupal/goodwell` | yes |
| `cmd-haven-project.sh` | Haven | `drupal/haven` | yes |
| `cmd-healthcare-project.sh` | Healthcare | `drupal/healthcare` | yes |
| `cmd-hourglass_inc-project.sh` | Hourglass Corporate | `drupal/hourglass_inc` | yes |
| `cmd-local-project.sh` | Local | `drupal/local` | yes |
| `cmd-lupus_decoupled_starter-project.sh` | Nuxt Starter | `drupal/lupus_decoupled_starter` | yes (no browse page) |
| `cmd-mercury_demo-project.sh` | Mercury Demo | `drupal/mercury_demo` | yes |
| `cmd-provus_edu-project.sh` | Provus EDU | `drupal/provus_edu` | yes |
| `cmd-pulse-project.sh` | Pulse | `drupal/pulse` | yes |
| `cmd-summit-project.sh` | Summit | `drupal/summit` | yes |

Paid templates are not built here, and Dripyard's *Meridian Charter* ($899) could not be
even if they were: it is not on Packagist at all, but in a private repository behind a
bearer token.

Remove a build with `bash cmd-tools-remove.sh <project>` (runs `ddev delete -y -O`).
