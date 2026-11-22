# Testing

## The core

- Unit: `node --test core/workspace-app/tests/unit/*.test.js` (Node's own runner). The plugin system has its own file, `plugin-system.test.js`, which drives `plugins.sh` against a temporary tree with `WORKSPACE_PLUGINS_NO_RESTART=1`, so a test never restarts the dashboard that serves this machine.
- Browser: `cd core/workspace-app && ddev test-dashboard browser` runs the webship-js (Playwright + cucumber-js) features under `tests/features` against the live dashboard, one scenario at a time. Every installed plugin's `features/*.feature` is placed under `tests/features/plugins/<name>/`, so the suite covers what is actually on.
- The same suite against any other dashboard (one started with node on a port, a fresh workspace): `cd core/workspace-app && LAUNCH_URL=http://localhost:<port> npx cucumber-js --config cucumber.js` (`npx playwright install chromium` once). CI does this on every pull request: the `browser` job starts the dashboard with node in the job, with a placeholder project in `dev`, `products` and `rag`, and runs the base's own features; the report and the dashboard's log are its artifact.
- A scenario that needs a state the machine may not be in carries a tag, and is skipped with the reason while that state is missing: `@needs-project-<folder>` (a project in that folder: any folder, with a `.ddev/config.yaml` where it opens the DDEV menu), `@needs-running-project`, `@needs-runtime-docker` / `@needs-runtime-kubernetes` / `@needs-runtime-podman` (a running site built with `--runtime` on that runtime, for the features in `tests/features/runtimes/`), `@needs-testing-stack`, `@needs-test-report`, `@needs-check-aliases`, `@needs-jira-writes-off`, `@needs-setting-<plugin>-<key>`. A plugin's features use the same tags.
- Scripts: `bash core/scripts/tests/cmd-smoke-test.sh` parses every `cmd-*.sh`.

## A project's suite and its step packs

`cmd-tools-testing.sh <project>` (in `dev`, `test`, `sandboxes`, `demos` and the other sites folders) sets the
webship-js stack up on a project that is already there, and `--run` runs it, in the project's container
(DDEV by default). A platform plugin adds its own step pack while the stack is set up
(`testing_configure_<name>`, in [the plugin contract](../workspace-app/PLUGINS.md#a-platform-as-a-plugin)).
On a project built on another runtime (`--runtime docker`, `podman` or `kubernetes`) the same command sets the
same stack up without the DDEV add-on: webship-js is installed and scaffolds itself (`init-webship-js`), and the
suite runs in a tests container of the Workspace's own image (`core/config/runtimes/tests`: Node.js 24 and the
libraries Playwright's browsers need), on the host's network, against the site's own address. The browsers and
npm's cache live in one volume every project shares (`webship-workspace-tests`).

Any other webship-js extra-steps pack (`@webship-js/<name>-steps`) is added from the same command:

```bash
bash cmd-tools-testing.sh mysite --list-steps                # every pack: version, what it is for, docs page, ✓ when the project has it
bash cmd-tools-testing.sh mysite --add-steps diffy,wordpress  # package.json, cucumber.js, then npm install in the container
bash cmd-tools-testing.sh mysite --examples wordpress         # the features it ships, into tests/features/wordpress-steps/
bash cmd-tools-testing.sh mysite --run --path tests/features/wordpress-steps/login.feature
bash cmd-tools-testing.sh mysite --remove-steps diffy         # exactly what --add-steps put in, nothing else
```

- **The list** is npm's (`@webship-js/*-steps`, read once a day into `core/workspace-app/.cache/step-packs.json`).
  When npm cannot be reached, it is the last answer it gave, then the list shipped in
  `core/config/step-packs.json`, which also says what each pack is: a platform, an extension of one
  (Drupal CMS of Drupal core), or a pack for any site (Diffy). npm's search ignores `scope:` today, so its
  answer is filtered by name and the `keywords:webship-js` search and the scope's own package list fill it in.
- **Adding** puts the pack in `devDependencies` at its latest release line (`^2.2.0`), its step definitions
  in `cucumber.js` after webship-js's own (the glob its README gives), and runs `npm install` (or `yarn
  install`) in the container. What it added is written in `tests/step-packs.json`, so `--remove-steps`
  takes out exactly that; a pack a platform plugin or a person added is never taken out. Running it
  again adds what a first run missed and changes nothing else.
- **A pack not on npm yet** (the one you are building) is added from its tarball or its folder, to prove
  it on a real project before its release: `--add-steps ../webship-js-x-steps-2.0.0.tgz`, or the pack's
  folder, which is packed with `npm pack` first. The tarball is copied into the project's
  `tests/step-packs/`, where its container sees it, and `devDependencies` points there
  (`file:tests/step-packs/webship-js-x-steps-2.0.0-<hash>.tgz`). A rebuilt tarball, added the same way,
  replaces the one before it and is installed again. It may take the place of a line `--add-steps` did not
  write (a platform plugin's testing hook writes its pack's npm line before that pack is on npm): what
  was there is written down, and `--remove-steps` puts it back, and deletes the copied tarball.
- **Settings** a pack reads (the `worldParameters` its README shows, or a `cucumber.js` it ships) that the project does not set are named,
  with the handles of the accounts its features log in as. Nothing is filled in: accounts and keys are yours.
- **Two platforms, two profiles.** Platform packs share phrases on purpose (the webship-js FAQ, "Can I
  load several step packs in one project?"), so a second one gets a profile of its own in `cucumber.js`
  (`module.exports['jira'] = …`, between `webship-workspace profile` markers), with its features in
  `tests/features/<pack>/`, which the default profile then leaves out. A pack for any site (Diffy) and an
  extension with its base go in one profile. `--run --profile jira` runs a profile; a `--path` inside a
  profile's folder picks it by itself. When `cucumber.js` has no default profile to build one on, the
  command stops and prints the profile to write.
- **Examples** are copied, never over a file, and stay when the pack is removed (the command says so). The
  files they use (an image to upload, a document) come along, from the pack's `tests/assets/` and
  `tests/fixtures/` into the project's own: the features name them from there.
- **A suggestion, never an install:** setting testing up reads the site's front page (a generator meta tag,
  Bootstrap's CSS or JS) and prints the pack that would fit it.
- **In the dashboard**, a site's **Tests** menu has the same: **Extra steps…** (every pack with its logo,
  version, what it is for and its docs page; Add, Remove, Copy examples) and **Run one feature…** (the
  project's features, the copied examples among them). Each button runs this command in a screen session
  ([the user guide](../workspace-app/docs/USER-GUIDE.md#test-it)).

## A plugin

`npm test` in the plugin's folder builds it (TypeScript to `dist/`) and runs its compiled tests. Its CI workflow does the same on push.

## The rule

A change lands through an issue and a pull request on the repository it belongs to, and is reviewed once the browser suite passes on a dashboard with the plugins installed from npm.
