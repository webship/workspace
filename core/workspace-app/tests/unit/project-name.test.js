/**
 * The name the Build form proposes.
 *
 * The shape is `<code><major>x<minor><patch>b<n>` — `v11x0xb1` is Varbase on the 11.0.x branch, first
 * build. Three things have to hold and they pull against each other: it must say what is being built,
 * it must never be a name that is already taken, and it must never cost somebody the name they typed.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { suggestProjectName, stemFor, versionBlock, shortCode } = require('../../project-name');
const { ROOT } = require('../../workspaces');

const SITE_TEMPLATES = path.join(ROOT, 'site-templates');
const DEV = path.join(ROOT, 'dev');
const TEST = path.join(ROOT, 'test');
const none = { existing: [] };

/* ---------------- the version block ---------------- */

test('the last segment is written the way the constraint writes it', () => {
  // This is the whole difference between the development branch and the release, and it is the
  // difference people most often need to see in a folder listing.
  assert.equal(versionBlock('11.0.x-dev'), '11x0x');
  assert.equal(versionBlock('~11.0.0'), '11x00');
  assert.equal(versionBlock('9.2.x-dev'), '9x2x');
  assert.equal(versionBlock('10.1.x-dev'), '10x1x');
  // A segment the constraint leaves out is 0.
  assert.equal(versionBlock('^1'), '1x00');
  assert.equal(versionBlock('^2'), '2x00');
  assert.equal(versionBlock(''), '');
});

test('a distribution and its line', () => {
  assert.equal(suggestProjectName(DEV, 'cmd-varbase11-0-x-project.sh', none), 'v11x0xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-varbase11-0-0-project.sh', none), 'v11x00b1');
  assert.equal(suggestProjectName(DEV, 'cmd-varbase9-2-x-project.sh', none), 'v9x2xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-varbase10-1-x-project.sh', none), 'v10x1xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupal11-recommended-project.sh', none), 'd11x00b1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupalcms2-x-project.sh', none), 'dc2x00b1');
});

/* ---------------- the code ---------------- */

test('several words give their initials, one word keeps its word', () => {
  // Reducing a single word to a letter is where a code scheme stops being readable and starts being
  // a puzzle — and it collides: Haven and Healthcare are both `h`, CareSphere and Convene both `c`.
  assert.equal(shortCode('horizonaid', 'Horizon Aid'), 'ha');
  assert.equal(shortCode('varbase_starter', 'Varbase Starter'), 'vs');
  assert.equal(shortCode('drupal_cms', 'Drupal CMS'), 'dc');
  assert.equal(shortCode('hourglass_inc', 'Hourglass Corporate'), 'hc');
  assert.equal(shortCode('haven', 'Haven'), 'haven');
  assert.equal(shortCode('byte', 'Byte'), 'byte');
  assert.equal(shortCode('educare', 'Educare'), 'educare');
});

test('short_codes: overrides the derivation', () => {
  // Varbase and Drupal are typed often enough to have earned a letter, and The Rightup would
  // otherwise be `tr` — a code for the word "the".
  assert.equal(shortCode('varbase', 'Varbase'), 'v');
  assert.equal(shortCode('drupal', 'Drupal'), 'd');
  assert.equal(suggestProjectName(DEV, 'cmd-rightup1-0-x-project.sh', none), 'rightup1x0xvb1');
});

test('a site template is named by its template, and its version by the template', () => {
  assert.equal(suggestProjectName(DEV, 'cmd-drupalcms2-x-educare1-0-0-project.sh', none), 'educare1x00b1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupalcms2-x-educare1-0-x-project.sh', none), 'educare1x0xb1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupalcms2-x-horizonaid1-0-0-project.sh', none), 'ha1x00b1');
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-byte-project.sh', none), 'byte1x00b1');
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-lupus_decoupled_starter-project.sh', none), 'ns2x00b1');
});

/* ---------------- the base ---------------- */

test('a template built on Varbase says so, and one on Drupal CMS does not', () => {
  // Drupal CMS is the base for nearly every site template, so saying so would lengthen every name for
  // nothing. Varbase is the exception, and it is a real difference: the same recipe at the same
  // version on the two bases is two different sites. Without this these two shared one name in six
  // workspaces.
  assert.equal(suggestProjectName(DEV, 'cmd-educare1-0-0-project.sh', none), 'educare1x00vb1');
  assert.equal(suggestProjectName(DEV, 'cmd-drupalcms2-x-educare1-0-0-project.sh', none), 'educare1x00b1');
});

test('a builder that picks its base from a flag claims neither', () => {
  // cmd-educare-project.sh assigns distribution_name twice, in the two halves of an if/else, and the
  // assignment reader is last-one-wins — so it reported Varbase for a builder whose DEFAULT is
  // Drupal CMS. It builds either, so it claims neither.
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-educare-project.sh', none), 'educare1x00b1');
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-educare-varbase-project.sh', none), 'educare1x00vb1');
});

/* ---------------- builders with nothing to read ---------------- */

test('automated testing is marked, not dropped', () => {
  // test/ holds BOTH cmd-varbase11-0-x-project.sh and its automated-testing twin, and a name that
  // cannot tell them apart is a name that sends somebody to the wrong project.
  assert.equal(suggestProjectName(TEST, 'cmd-automated-testing-varbase11-0-x-project.sh', none), 'atv11x0xb1');
  assert.equal(suggestProjectName(TEST, 'cmd-automated-testing-varbase9-2-x-project.sh', none), 'atv9x2xb1');
  assert.equal(suggestProjectName(TEST, 'cmd-automated-testing-educare1-0-0-project.sh', none), 'ateducare1x00b1');
  assert.notEqual(suggestProjectName(TEST, 'cmd-automated-testing-varbase11-0-x-project.sh', none),
    suggestProjectName(TEST, 'cmd-varbase11-0-x-project.sh', none));
});

test('a builder with no version keeps its name and a plain counter', () => {
  // There is nothing there for a number to be confused with, and a lone `p1` says less than the
  // folder already did.
  assert.equal(suggestProjectName(path.join(ROOT, 'designs'), 'cmd-penpot-project.sh', none), 'penpot1');
  assert.equal(suggestProjectName(path.join(ROOT, 'rag'), 'cmd-milvus-project.sh', none), 'milvus1');
  assert.equal(suggestProjectName(TEST, 'cmd-claudecodeui-project.sh', none), 'claudecodeui1');
});

/* ---------------- the counter ---------------- */

test('b marks the build, and counts past the highest taken', () => {
  const s = 'cmd-varbase11-0-x-project.sh';
  assert.equal(suggestProjectName(DEV, s, { existing: [] }), 'v11x0xb1');
  assert.equal(suggestProjectName(DEV, s, { existing: ['v11x0xb1'] }), 'v11x0xb2');
  // The gap is deliberately NOT filled: `b2` may still be in a bookmark, a DDEV router entry or
  // somebody's notes, and handing that name to a different site is worse than skipping a number.
  assert.equal(suggestProjectName(DEV, s, { existing: ['v11x0xb1', 'v11x0xb3'] }), 'v11x0xb4');
  // Written by hand, either way, it is still the second one.
  assert.equal(suggestProjectName(DEV, s, { existing: ['v11x0x-2'] }), 'v11x0xb3');
});

test('a name that only starts with the stem does not count', () => {
  assert.equal(suggestProjectName(DEV, 'cmd-varbase11-0-x-project.sh',
    { existing: ['v11x0xbackup', 'v11x0xb1x', 'myv11x0xb3'] }), 'v11x0xb1');
});

/* ---------------- across the whole tree ---------------- */

test('a script that is not there suggests nothing, rather than a name built from a typo', () => {
  assert.equal(suggestProjectName(SITE_TEMPLATES, 'cmd-no-such-thing-project.sh', none), '');
  assert.equal(stemFor(SITE_TEMPLATES, 'cmd-no-such-thing-project.sh'), '');
});

test('EVERY builder in EVERY workspace proposes a usable name', () => {
  const { loadWorkspaces, findBuilderScripts, workspaceDir } = require('../../workspaces');
  const bad = [];
  let checked = 0;
  for (const w of Object.values(loadWorkspaces())) {
    const dir = workspaceDir(w.key);
    let scripts = [];
    try { scripts = findBuilderScripts(dir); } catch (_) { continue; }
    for (const script of scripts) {
      checked += 1;
      const name = suggestProjectName(dir, script, none);
      // The Build form's own pattern. A suggestion the form would then refuse is worse than none.
      if (!/^[a-zA-Z0-9_-]+$/.test(name)) bad.push(`${w.key}/${script} -> ${JSON.stringify(name)}`);
    }
  }
  assert.ok(checked > 150, `only ${checked} builders were reached`);
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('no two builders share a name unless they build the same thing', () => {
  // A code scheme lives or dies on this. The four that remain are `cmd-<template>-project.sh` against
  // `cmd-drupalcms2-x-<template>1-0-0-project.sh`: the same template, on the same base, on its
  // released line — `^1` against `~1.0.0`, which differ only in how far the constraint floats. They
  // build the same site, so one name is the honest answer and the counter keeps the folders apart.
  const { loadWorkspaces, findBuilderScripts, workspaceDir } = require('../../workspaces');
  const unexpected = [];
  for (const w of Object.values(loadWorkspaces())) {
    const dir = workspaceDir(w.key);
    let scripts = [];
    try { scripts = findBuilderScripts(dir); } catch (_) { continue; }
    const by = new Map();
    for (const s of scripts) {
      const stem = stemFor(dir, s);
      if (!by.has(stem)) by.set(stem, []);
      by.get(stem).push(s);
    }
    for (const [stem, list] of by) {
      if (list.length < 2) continue;
      const sameThing = list.every((s) => /^cmd-drupalcms2-x-.*1-0-0-project\.sh$/.test(s)
        || /^cmd-[a-z_]+-(drupalcms-)?project\.sh$/.test(s));
      if (!sameThing) unexpected.push(`${w.key}/${stem} <- ${list.join(', ')}`);
    }
  }
  assert.deepEqual(unexpected, [], unexpected.join('\n'));
});
