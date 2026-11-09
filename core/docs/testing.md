# Testing

## The core

- Unit: `node --test core/workspace-app/tests/unit/*.test.js` (Node's own runner). The plugin system has its own file, `plugin-system.test.js`, which drives `plugins.sh` against a temporary tree with `WORKSPACE_PLUGINS_NO_RESTART=1`, so a test never restarts the dashboard that serves this machine.
- Browser: `cd core/workspace-app && ddev test-dashboard browser` runs the webship-js (Playwright + cucumber-js) features under `tests/features` against the live dashboard, one scenario at a time. Every installed plugin's `features/*.feature` is placed under `tests/features/plugins/<name>/`, so the suite covers what is actually on.
- Scripts: `bash core/scripts/tests/cmd-smoke-test.sh` parses every `cmd-*.sh`.

## A plugin

`npm test` in the plugin's folder builds it (TypeScript to `dist/`) and runs its compiled tests. Its CI workflow does the same on push.

## The rule

A change lands through an issue and a pull request on the repository it belongs to, and is reviewed once the browser suite passes on a dashboard with the plugins installed from npm.
