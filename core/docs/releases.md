# Releases

Every package is versioned together: `@webship.co/workspace` (the core) and every `@webship.co/workspace-<name>`. Versions so far: 1.0.0-alpha1 (the first publish), 1.0.0-beta1.

## How a change lands

1. An issue on the repository it belongs to (`github.com/webship/workspace` for the core, `workspace-<name>` for a plugin), with the Checkpoints list.
2. A branch and a pull request against `1.0.x`, referencing the issue.
3. The unit tests and the browser suite pass; a human reviews; the pull request is merged.

## Publishing

Bases first (`workspace-plugin-api`, `workspace-hosting`, `workspace-forge`, `workspace-container`), then the providers and the rest, then the core — one package at a time with a pause between them, within npm's publishing limits. A dependency on a sibling is a version range (`^1.0.0-beta1`), never a git URL.

## Upgrading a workspace

```bash
npm install -g @webship.co/workspace@latest
webship-workspace update ~/workspace
cd ~/workspace/core/workspace-app && npm update
```

`update` refreshes the core and keeps every settings file; `npm update` moves the installed plugins to their newest versions within the ranges in `package.json`.
