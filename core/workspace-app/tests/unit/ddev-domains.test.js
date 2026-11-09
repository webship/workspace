/**
 * The addresses a DDEV project answers at.
 *
 * The bug these were written for: the dashboard read `additional_hostnames` and nothing else, so a
 * project with a Storybook showed no extra domains at all — Webship writes its Storybook address
 * into `additional_fqdns`, which is a different key with different rules. Seven projects in the
 * tree had a Storybook the dashboard never mentioned.
 */

'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { copyConfig } = require('./_isolated-config');

// The walk over the workspaces runs on a tree built here, not on this checkout: a fresh clone holds no
// project at all. The workspaces module reads its root once, at load, so it is set before the require.
const REPO = path.join(__dirname, '../../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ddev-domains-root-'));
process.env.WORKSPACE_ROOT = root;

const { ddevHostnames, ddevExtraDomains } = require('../../ddev-domains');
const { loadWorkspaces } = require('../../workspaces');

/** A DDEV project inside a workspace of the built tree. */
function inTree(workspace, name, yaml) {
  const dir = path.join(root, workspace, name);
  fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
  if (yaml !== null) fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), yaml);
}

before(() => {
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  inTree('dev', 'blog', 'name: blog\nadditional_fqdns:\n  - storybook.blog.ddev.site\n');
  inTree('dev', 'plain', 'name: plain\nadditional_hostnames:\n  - plain-dev\n');
  inTree('products', 'shop', 'name: shop\nadditional_fqdns:\n  - mail.shop.ddev.site\n');
  inTree('products', 'bare', null);
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

/** A throwaway project directory holding one .ddev/config.yaml. */
function project(yaml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddev-domains-'));
  fs.mkdirSync(path.join(dir, '.ddev'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.ddev', 'config.yaml'), yaml);
  return dir;
}

/* ---------------- the two keys ---------------- */

test('a label takes the TLD, a fqdn does not', () => {
  // The whole distinction. Folding a fqdn into the label list would give
  // storybook.blog.ddev.site.ddev.site, which resolves to nothing.
  const dir = project(`name: blog
project_tld: ddev.site
additional_hostnames:
  - blog-dev
additional_fqdns:
  - storybook.blog.ddev.site
`);
  assert.deepEqual(ddevExtraDomains(dir).map((d) => d.host),
    ['blog-dev.ddev.site', 'storybook.blog.ddev.site']);
});

test('a custom project_tld reaches the labels and leaves the fqdns alone', () => {
  const dir = project(`name: blog
project_tld: example.test
additional_hostnames:
  - alias
additional_fqdns:
  - storybook.blog.ddev.site
`);
  assert.deepEqual(ddevExtraDomains(dir).map((d) => d.host),
    ['alias.example.test', 'storybook.blog.ddev.site']);
});

test('both keys are read in flow style as well as block style', () => {
  const dir = project(`name: blog
additional_hostnames: [one, "two"]
additional_fqdns: ['storybook.blog.ddev.site']
`);
  assert.deepEqual(ddevHostnames(dir).list, ['one', 'two']);
  assert.deepEqual(ddevHostnames(dir).fqdns, ['storybook.blog.ddev.site']);
});

test('the two lists stay apart, because one of them is compared against labels', () => {
  // hostnameOwner compares `list` entries as LABELS. A fqdn in there would be compared against a
  // label and never match, which is a collision check that silently stops checking.
  const dir = project(`name: blog
additional_hostnames:
  - alias
additional_fqdns:
  - storybook.blog.ddev.site
`);
  const h = ddevHostnames(dir);
  assert.deepEqual(h.list, ['alias']);
  assert.deepEqual(h.fqdns, ['storybook.blog.ddev.site']);
});

/* ---------------- what must NOT be read ---------------- */

test("DDEV's own commented-out examples are not hostnames", () => {
  // A stock config.yaml ships these. A parser that reads them hands every project in the tree two
  // hostnames it never had, and the collision check then reports conflicts that do not exist.
  const dir = project(`name: blog
# additional_hostnames:
#  - somename
#  - someothername
# additional_fqdns:
#  - example.com
`);
  assert.deepEqual(ddevExtraDomains(dir), []);
});

test('a folder that is not a DDEV project answers nothing rather than throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-ddev-'));
  assert.deepEqual(ddevExtraDomains(dir), []);
  assert.deepEqual(ddevHostnames(dir), { list: [], fqdns: [], tld: 'ddev.site' });
});

test('an empty list is empty, not a list holding nothing', () => {
  const dir = project(`name: blog
additional_hostnames: []
additional_fqdns:
  - storybook.blog.ddev.site
`);
  assert.deepEqual(ddevExtraDomains(dir).map((d) => d.host), ['storybook.blog.ddev.site']);
});

test('the same address declared twice is listed once', () => {
  const dir = project(`name: blog
additional_fqdns:
  - storybook.blog.ddev.site
  - storybook.blog.ddev.site
`);
  assert.equal(ddevExtraDomains(dir).length, 1);
});

/* ---------------- which one is Storybook ---------------- */

test('Storybook is marked, and only Storybook', () => {
  const dir = project(`name: blog
additional_fqdns:
  - storybook.blog.ddev.site
  - mail.blog.ddev.site
  - my-storybook-notes.blog.ddev.site
`);
  const got = ddevExtraDomains(dir);
  assert.deepEqual(got.map((d) => d.storybook), [true, false, false],
    'only a host whose FIRST label is storybook is the component library');
});

/* ---------------- against the tree built above ---------------- */

test('the projects in this tree that ship a Storybook are found', () => {
  // The regression in one line: before this parsed additional_fqdns, every one of these was absent.
  const found = [];
  for (const w of Object.values(loadWorkspaces())) {
    if (!w.dir) continue;
    let names = [];
    try {
      names = fs.readdirSync(w.dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
    } catch (_) { continue; }
    for (const n of names) {
      if (ddevExtraDomains(path.join(w.dir, n)).some((d) => d.storybook)) found.push(`${w.key}/${n}`);
    }
  }
  assert.ok(found.length > 0,
    'no project in the tree declares a Storybook domain: the fqdn key stopped being read');
  for (const p of found) assert.ok(p.includes('/'), p);
  assert.deepEqual(found, ['dev/blog'],
    'the one with a storybook fqdn, and not the label-only, the mail-only or the project with no config');
});
