# Testing

## The core

- Unit: `node --test core/workspace-app/tests/unit/*.test.js` (Node's own runner). The plugin system has its own file, `plugin-system.test.js`, which drives `plugins.sh` against a temporary tree with `WORKSPACE_PLUGINS_NO_RESTART=1`, so a test never restarts the dashboard that serves this machine.
- Browser: `cd core/workspace-app && ddev test-dashboard browser` runs the webship-js (Playwright + cucumber-js) features under `tests/features` against the live dashboard, one scenario at a time. Every installed plugin's `features/*.feature` is placed under `tests/features/plugins/<name>/`, so the suite covers what is actually on.
- The same suite against any other dashboard (one started with node on a port, a fresh workspace): `cd core/workspace-app && LAUNCH_URL=http://localhost:<port> npx cucumber-js --config cucumber.js` (`npx playwright install chromium` once). CI does this on every pull request: the `browser` job starts the dashboard with node in the job, with a placeholder project in `dev`, `products` and `rag`, and runs the base's own features; the report and the dashboard's log are its artifact.
- A scenario that needs a state the machine may not be in carries a tag, and is skipped with the reason while that state is missing: `@needs-project-<folder>` (a project in that folder: any folder, with a `.ddev/config.yaml` where it opens the DDEV menu), `@needs-running-project`, `@needs-testing-stack`, `@needs-test-report`, `@needs-check-aliases`, `@needs-jira-writes-off`, `@needs-setting-<plugin>-<key>`. A plugin's features use the same tags.
- Scripts: `bash core/scripts/tests/cmd-smoke-test.sh` parses every `cmd-*.sh`.

## A plugin

`npm test` in the plugin's folder builds it (TypeScript to `dist/`) and runs its compiled tests. Its CI workflow does the same on push.

## The rule

A change lands through an issue and a pull request on the repository it belongs to, and is reviewed once the browser suite passes on a dashboard with the plugins installed from npm.
