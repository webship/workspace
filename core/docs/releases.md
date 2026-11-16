# Releases

Every package is versioned together: `@webship.co/workspace` (the core) and every `@webship.co/workspace-<name>`. Versions so far: 1.0.0-alpha1 (the first publish), 1.0.0-beta1, 1.0.0-beta2, 1.0.0-rc1, 1.0.0, 1.0.1 (the core and the git, ide and graph plugins only), 1.0.2, 1.0.3, 1.0.4, 1.0.5 and 1.0.6 (the core only), 1.0.7 (the core, the plugin types and the first platform plugin, WordPress; the other platform plugins followed at 1.0.7), 1.0.8 (the core only), 1.0.9 (the core and the plugin types: what a plugin needs), 1.0.10 (the core, the plugin types and the first release of the screens plugin), 1.0.11 (the core: AI items and commands from several repositories into any AI CLI), 1.0.12 (the core and the plugin types: what the Avatars plugin needs for characters, the board, the reading window and speech), 1.0.13 (the core and the plugin types: Settings for a base with plugins, commands in screens only), 1.0.14 (the core: screen sessions on a machine without screen), 1.0.15 (the core: two fixes for a fresh workspace), 1.0.16 (the core: fixes from the first testing rounds of the plugin lifecycle and the pages), 1.0.17 (the core: fixes from the rounds on the platform plugins and the AI items), 1.0.18 (the core: fixes from the round on tests, lint and CI).

## How a change lands

1. An issue on the repository it belongs to (`github.com/webship/workspace` for the core, `workspace-<name>` for a plugin), with the Checkpoints list.
2. A branch and a pull request against `1.0.x`, referencing the issue.
3. The unit tests and the browser suite pass; a human reviews; the pull request is merged.

## Publishing

One package at a time, within npm's publishing limits, in this order: the types (`workspace-plugin-api`), the bases (`workspace-hosting`, `workspace-forge`, `workspace-container`), the providers and the other plugins, and the core last. A dependency on a sibling is a version range (`^1.0.2`), never a git URL.

For each package:

1. Set `version` in `package.json` and every `@webship.co/workspace-*` range to the version of the round.
2. Run `npm install` so that `package-lock.json` resolves the siblings already published in this round, and commit the two files together. CI runs `npm ci`, which refuses a lock file that is out of step with `package.json`.
3. Push `1.0.x` with the `v<version>` tag, publish with `npm publish --access public`, and create the GitHub release.
4. Before moving on to a package that depends on this one, wait until `npm view @webship.co/workspace-<name>@<version> version` answers: the registry takes a minute or two to serve a new version, and a dependent pushed before that fails its CI with `No matching version found`.

The 1.0.0 round pushed every version commit before any package was published and left the regenerated lock files uncommitted, so the CI of every plugin was red from that commit until 1.0.2.

## Upgrading a workspace

```bash
npx -y @webship.co/workspace@latest update ~/workspace
```

`update` refreshes the core (`core/scripts`, `core/config`, the dashboard, `commands/`) and keeps every settings file, the plugins you required in `core/workspace-app/package.json`, and this machine's own values in the dashboard's `.ddev/` (its project name, its docker GID). It repairs what an earlier release left broken in `settings.yml`, removes the files a release stopped shipping while they are as shipped, notes how the installed plugins shipped their files, and restarts the dashboard when it serves this workspace.

Then each plugin, which places the files of its new version: Settings → Plugins → the plugin → **Update to <version>**, then **Reinstall**; or from a terminal

```bash
webship-workspace plugin require <name>
webship-workspace plugin install <name>
```

`npm update` in `core/workspace-app` moves the packages but not the files they placed: use the two steps above. A file a person changed in what a plugin placed is kept beside the new one as `<file>.yours`.
