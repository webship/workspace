/**
 * Which cmd-*.sh the Build a new project picker offers.
 *
 * Getting this wrong is invisible: a builder that is filtered out does not error, it is simply not
 * in the list, and nobody notices until somebody goes looking for the one they came for. That is
 * exactly what happened — `cmd-automated-testing-*-project.sh` was excluded by name, so the test
 * workspace offered nine of its fourteen builders and the five missing ones were the reason to open
 * that page at all.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findBuilderScripts, builderLabel } = require('../../workspaces');

function folder(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-builders-'));
  for (const [name, body] of Object.entries(names)) fs.writeFileSync(path.join(dir, name), body);
  return dir;
}

test('a builder is a cmd-*-project.sh that is not a per-project tool', () => {
  const dir = folder({
    'cmd-varbase11-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-drupal11-recommended-project.sh': '#!/usr/bin/env bash\n',
    // Tools, however they end: backup and graphify act ON a project, they do not build one.
    'cmd-tools-backup-dev.sh': '#!/usr/bin/env bash\n',
    'cmd-tool-something-project.sh': '#!/usr/bin/env bash\n',
    'cmd-tools-graphify.sh': '#!/usr/bin/env bash\n',
    // Not a command at all.
    'AGENTS.md': '# x\n',
  });
  assert.deepEqual(findBuilderScripts(dir),
    ['cmd-drupal11-recommended-project.sh', 'cmd-varbase11-0-x-project.sh']);
});

test('an automated-testing builder is a builder', () => {
  // It builds a whole site and scaffolds its testing stack on top, which is why the test workspace
  // exists. It was excluded by name, and the list it was missing from was the one that needed it.
  const dir = folder({
    'cmd-automated-testing-varbase11-0-x-project.sh': '#!/usr/bin/env bash\n\n# workspace-name: Varbase 11.0.x + Automated Testing (Playwright)\n',
    'cmd-varbase11-0-x-project.sh': '#!/usr/bin/env bash\n\n# workspace-name: Varbase 11.0.x\n',
  });
  const found = findBuilderScripts(dir);
  assert.equal(found.length, 2);
  assert.ok(found.includes('cmd-automated-testing-varbase11-0-x-project.sh'));
});

test('a builder label names the site and what is set up, not the runner', () => {
  // Which runner drives it — varbase-e2e, and Playwright underneath — is an implementation detail of
  // the stack. In the label it dates the entry and makes two builders that do the same thing look
  // like two different things.
  const { ROOT } = require('../../workspaces');
  const dir = path.join(ROOT, 'test');
  if (!fs.existsSync(dir)) return;
  for (const f of findBuilderScripts(dir)) {
    const label = builderLabel(dir, f);
    assert.ok(!/playwright|varbase-e2e/i.test(label), `${f} names its runner in the label: ${label}`);
    if (f.startsWith('cmd-automated-testing-')) {
      assert.match(label, /Automated Functional Testing$/, `${f} should say what it sets up`);
    }
  }
});

test('a builder is labelled by its own header, not by its filename', () => {
  const dir = folder({
    'cmd-automated-testing-varbase11-0-x-project.sh': '#!/usr/bin/env bash\n\n# workspace-name: Varbase 11.0.x + Automated Testing (Playwright)\n',
    'cmd-nameless-project.sh': '#!/usr/bin/env bash\n',
  });
  assert.equal(builderLabel(dir, 'cmd-automated-testing-varbase11-0-x-project.sh'),
    'Varbase 11.0.x + Automated Testing (Playwright)');
  // No header is not an error — the filename is a worse name, not no name.
  assert.equal(builderLabel(dir, 'cmd-nameless-project.sh'), 'cmd-nameless-project.sh');
});

test('a pinned builder says the constraint it installs, and pairs with a branch one', () => {
  // `11-0-x` is the branch (11.0.x-dev) and `11-0-0` is the released tag (~11.0.0). The label used to
  // say "Varbase 11.0.0" beside "Varbase 11.0.x", which reads as two versions of the same kind of
  // thing rather than a tag and a branch. Asserted against the tree, in every workspace that builds.
  const { ROOT } = require('../../workspaces');
  for (const ws of ['dev', 'test', 'demos', 'sandboxes']) {
    const dir = path.join(ROOT, ws);
    if (!fs.existsSync(dir)) continue;
    for (const f of findBuilderScripts(dir)) {
      const body = fs.readFileSync(path.join(dir, f), 'utf8');
      const pinned = /^(site_version|[a-z]+_version|site_template_version_default)="~([0-9.]+)"/m.exec(body);
      if (!pinned) continue;
      assert.ok(builderLabel(dir, f).includes(`~${pinned[2]}`),
        `${ws}/${f} installs ~${pinned[2]} but its label does not say so: ${builderLabel(dir, f)}`);
      // Every pinned builder is the twin of a branch one, never an orphan.
      assert.ok(fs.existsSync(path.join(dir, f.replace(/-(\d+)-(\d+)-0-/, '-$1-$2-x-'))),
        `${ws}/${f} has no branch twin`);
    }
  }
});

test('the test workspace really does offer every builder it ships', () => {
  // Against the tree itself: the bug was a filter that looked right in isolation.
  const dir = path.join(require('../../workspaces').ROOT, 'test');
  if (!fs.existsSync(dir)) return;                       // a clone without the workspaces built
  const onDisk = fs.readdirSync(dir)
    .filter((f) => /^cmd-.*-project\.sh$/.test(f) && !/^cmd-tools?-/.test(f)).sort();
  // Compared as a SET: the list is no longer alphabetical — BUILDER_ORDER puts the current
  // Drupal, the next one, Varbase and the site templates at the head — and what this test is
  // about is that nothing is missing, not what order it comes in.
  assert.deepEqual([...findBuilderScripts(dir)].sort(), onDisk);
  assert.ok(onDisk.some((f) => f.startsWith('cmd-automated-testing-')), 'including the testing ones');
});

test('the builders people reach for are at the head of the list, in order', () => {
  // Alphabetical put eleven `cmd-automated-testing-…` builds above everything in the test
  // workspace, and `cmd-drupalcms2-x-educare…` above Drupal and Varbase everywhere else.
  const dir = folder({
    'cmd-automated-testing-varbase11-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-drupalcms2-x-educare1-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-varbase9-1-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-rightup1-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-horizonaid1-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-educare1-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-varbase_starter1-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-varbase11-0-x-project.sh': '#!/usr/bin/env bash\n',
    'cmd-drupal12-recommended-project.sh': '#!/usr/bin/env bash\n',
    'cmd-drupal11-recommended-project.sh': '#!/usr/bin/env bash\n',
  });
  assert.deepEqual(findBuilderScripts(dir).slice(0, 7), [
    'cmd-drupal11-recommended-project.sh',
    'cmd-drupal12-recommended-project.sh',
    'cmd-varbase11-0-x-project.sh',
    'cmd-varbase_starter1-0-x-project.sh',
    'cmd-educare1-0-x-project.sh',
    'cmd-horizonaid1-0-x-project.sh',
    'cmd-rightup1-0-x-project.sh',
  ]);
  // Then the Drupal CMS site templates, grouped — the same four in the same order on the other base,
  // rather than interleaved with the Varbase ones by the alphabet.
  assert.deepEqual(findBuilderScripts(dir).slice(7, 8), ['cmd-drupalcms2-x-educare1-0-x-project.sh']);
  // Everything unnamed keeps its alphabetical place below, so a new builder needs no code
  // change unless it belongs at the top.
  assert.deepEqual(findBuilderScripts(dir).slice(8), [
    'cmd-automated-testing-varbase11-0-x-project.sh',
    'cmd-varbase9-1-x-project.sh',
  ]);
});

test('every workspace that builds sites offers Drupal 12', () => {
  const { ROOT } = require('../../workspaces');
  for (const ws of ['dev', 'test', 'demos', 'sandboxes', 'projects']) {
    const dir = path.join(ROOT, ws);
    if (!fs.existsSync(dir)) continue;                   // a clone without the workspaces built
    const found = findBuilderScripts(dir);
    assert.ok(found.includes('cmd-drupal12-recommended-project.sh'), `${ws} has the Drupal 12 builder`);
    assert.equal(builderLabel(dir, 'cmd-drupal12-recommended-project.sh'), 'Drupal 12 (latest)');
  }
});
