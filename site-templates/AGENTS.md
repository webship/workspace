# Site Templates

Every free Drupal CMS site template, and the Vardot ones (Horizon Aid, Educare, The Rightup,
Varbase Starter).

**Two lists, and they do not agree.** [new.drupal.org/browse/site-templates][browse] is the shop
window; `drupal_cms_installer`'s own [`site-templates.yml`][curated] is what the installer actually
offers. `dashi` is browsable but not in the installer's list; `forma` and `lupus_decoupled_starter`
are in the installer's list with no browse page. This folder builds the **union of the two, free
only**, and every builder records which side it is on:

- `site_template_listed="yes"` — the installer fetches the recipe when it is picked, so the default
  build is the plain `composer create-project drupal/cms` the project page publishes. `--install` and
  an explicit `--site-template-version` still `require` it: drush cannot download anything, and the
  installer always takes the latest release.
- Without it, the package is required on every path — the only thing that works for a template the
  installer does not list.

`--install` installs with drush; on the four Vardot builders `--distribution varbase` builds on
Varbase 11 instead. Paid templates are not built here, and Dripyard's *Meridian Charter* could not be
even if they were: it is not on Packagist, but in a private repository behind a bearer token.

[browse]: https://new.drupal.org/browse/site-templates
[curated]: https://git.drupalcode.org/project/drupal_cms_installer/-/blob/HEAD/site-templates.yml

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. Everything
here is driven by the `cmd-*.sh` scripts in this folder — run them from here, never from the
git clone in `products/workspace`, which ships the tooling but builds nothing.

## Agent

Use the **`webship-workspace`** agent for work in this folder. It knows the build chain, the
DDEV rules and how to author a new command.

## Skills

- **`webship-workspace-site-templates`**
- **`webship-workspace-build`**

## Commands here

```bash
bash cmd-archimedes-project.sh --help
bash cmd-byte-project.sh --help
bash cmd-caresphere-project.sh --help
bash cmd-convene-project.sh --help
bash cmd-convivial_gov-project.sh --help
bash cmd-dashi-project.sh --help
bash cmd-drupalcms2-x-educare1-0-0-project.sh --help
bash cmd-drupalcms2-x-educare1-0-x-project.sh --help
bash cmd-drupalcms2-x-horizonaid1-0-0-project.sh --help
bash cmd-drupalcms2-x-horizonaid1-0-x-project.sh --help
bash cmd-drupalcms2-x-rightup1-0-0-project.sh --help
bash cmd-drupalcms2-x-rightup1-0-x-project.sh --help
bash cmd-drupalcms2-x-varbase_starter1-0-0-project.sh --help
bash cmd-drupalcms2-x-varbase_starter1-0-x-project.sh --help
bash cmd-educare-drupalcms-project.sh --help
bash cmd-educare-project.sh --help
bash cmd-educare-varbase-project.sh --help
bash cmd-everbright-project.sh --help
bash cmd-forma-project.sh --help
bash cmd-goodwell-project.sh --help
bash cmd-haven-project.sh --help
bash cmd-healthcare-project.sh --help
bash cmd-horizonaid-project.sh --help
bash cmd-hourglass_inc-project.sh --help
bash cmd-local-project.sh --help
bash cmd-lupus_decoupled_starter-project.sh --help
bash cmd-mercury_demo-project.sh --help
bash cmd-provus_edu-project.sh --help
bash cmd-pulse-project.sh --help
bash cmd-rightup-project.sh --help
bash cmd-summit-project.sh --help
bash cmd-tools-checks.sh --help
bash cmd-tools-clone.sh --help
bash cmd-tools-graphify.sh --help
bash cmd-tools-ragify.sh --help
bash cmd-tools-reclaim.sh --help
bash cmd-tools-remove.sh --help
bash cmd-tools-screen.sh --help
bash cmd-varbase_starter-project.sh --help
```

## Hard rules

- **DDEV only** — `ddev composer`, `ddev drush`, `ddev delete -y -O`, `ddev export-db`. Never raw
  composer, drush or mysql on the host.
- **Never write a `$databases` block into `settings.php`** — DDEV's `settings.ddev.php` owns it.
- `ddev start` accepts `-y`; **`ddev stop` does not**.
- Every `cmd-*-project.sh` carries a `# workspace-name:` header — the smoke test enforces it.
- Validate a change with `bash core/scripts/tests/cmd-smoke-test.sh`.
- **Clean up after your own work, and ASK before you do.** A scratch project you built to check
  something, a folder or file you made to test with: when the goal is met, say plainly what you
  created and offer to remove it. Never delete it unasked — the user may still want to look — and
  never walk away leaving it unmentioned either.
- **Removing a project is a command, not `rm -rf`.** `bash cmd-tools-remove.sh <project>` from this
  folder, or `ddev delete -y -O` inside the project. Deleting the folder alone leaves the DDEV
  registry entry, the database volume, the snapshots volume and the per-project built images behind —
  invisible until the disk is full. `cmd-tools-reclaim.sh` in this folder finds that debris afterwards, but
  not creating it is better.

The full architecture is in `products/workspace/CLAUDE.md`.
