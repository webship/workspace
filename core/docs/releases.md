# Releases

Every package is versioned together: `@webship.co/workspace` (the core) and every `@webship.co/workspace-<name>`. Versions so far: 1.0.0-alpha1 (the first publish), 1.0.0-beta1, 1.0.0-beta2, 1.0.0-rc1, 1.0.0, 1.0.1 (the core and the git, ide and graph plugins only), 1.0.2.

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
npm install -g @webship.co/workspace@latest
webship-workspace update ~/workspace
cd ~/workspace/core/workspace-app && npm update
```

`update` refreshes the core and keeps every settings file; `npm update` moves the installed plugins to their newest versions within the ranges in `package.json`.
