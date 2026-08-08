# Profiles

Contrib and private installation profiles, checked out to work on.

Part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness. The rules in the root
`CLAUDE.md` apply here too; what follows is what is specific to this folder.

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

## Commands here

```bash
bash cmd-build-profiles-bear.sh
bash cmd-build-profiles-commerce.sh
bash cmd-build-profiles-cucumber.sh
bash cmd-build-profiles-degov.sh
bash cmd-build-profiles-droopler.sh
bash cmd-build-profiles-dropsolid_rocketship.sh
bash cmd-build-profiles-drupal_demo_umami.sh
bash cmd-build-profiles-drupal_minimal.sh
bash cmd-build-profiles-drupal_standard.sh
bash cmd-build-profiles-drustack.sh
bash cmd-build-profiles-drutopia.sh
bash cmd-build-profiles-govcms8.sh
bash cmd-build-profiles-lightning.sh
bash cmd-build-profiles-mandatory.sh
bash cmd-build-profiles-openedu.sh
bash cmd-build-profiles-openfed.sh
bash cmd-build-profiles-openlucius.sh
bash cmd-build-profiles-openrestaurant.sh
bash cmd-build-profiles-openy.sh
bash cmd-build-profiles-opigno_lms.sh
bash cmd-build-profiles-orange_ecom_profile.sh
bash cmd-build-profiles-panopoly.sh
bash cmd-build-profiles-paragon.sh
bash cmd-build-profiles-pino.sh
bash cmd-build-profiles-presto.sh
bash cmd-build-profiles-quick_start.sh
bash cmd-build-profiles-sector.sh
bash cmd-build-profiles-seeds.sh
bash cmd-build-profiles-sm_dev_portal.sh
bash cmd-build-profiles-social.sh
bash cmd-build-profiles-splashawards.sh
bash cmd-build-profiles-thunder.sh
bash cmd-build-profiles-university.sh
bash cmd-build-profiles-webship.sh
bash cmd-build-profiles-wxt.sh
bash cmd-build-profiles.sh                            # Bootstrap.
bash cmd-tools-graphify.sh                            # Map a project in this workspace into a queryable knowledge graph with
bash cmd-tools-ragify.sh                              # Index a project in this workspace into the Milvus vector database
bash cmd-tools-remove.sh                              # Bootstrap.
bash cmd-tools-update-all.sh                          # Bootstrap.
```

Every one locates the workspace from its own path, so there is nothing to export and nothing to
install. `--help` on any of them lists its arguments.
