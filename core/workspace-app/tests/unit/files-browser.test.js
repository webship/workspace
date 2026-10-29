/**
 * Browsing a documents folder, not just the top of it.
 *
 * `docs/` holds 29 folders and 8,105 files and the page listed 21 rows: everything in a subfolder was
 * invisible, and so was every file whose extension was not on a curated list. The folder on disk and
 * the page describing it disagreed, which is the one thing a file listing must not do.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fb = require('../../files-browser');

const APP = path.join(__dirname, '../..');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
const lists = fs.readFileSync(path.join(APP, 'lists.js'), 'utf8');
const del = fs.readFileSync(path.join(APP, 'actions/ai-items.js'), 'utf8');

/** A workspace-shaped fixture: two folders, a file, some noise, and a symlink pointing out of it. */
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-files-'));
  const root = path.join(base, 'docs');
  const outside = path.join(base, 'secrets');
  fs.mkdirSync(path.join(root, 'shots'), { recursive: true });
  fs.mkdirSync(path.join(root, 'shots', 'raw'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'keys.txt'), 'nope');
  fs.writeFileSync(path.join(root, 'guide.pdf'), 'x');
  fs.writeFileSync(path.join(root, 'shots', 'one.png'), 'x');
  fs.writeFileSync(path.join(root, 'shots', 'two.png'), 'x');
  fs.symlinkSync(outside, path.join(root, 'escape'));
  return { base, root, outside };
}

test('a path from the browser is split, resolved, and refused when it leaves the workspace', () => {
  const { root } = fixture();
  assert.equal(fb.safeSubIn(root, '').rel, '', 'no path is the top of the workspace');
  assert.equal(fb.safeSubIn(root, 'shots/raw').rel, 'shots/raw');
  // The segment check, which catches the obvious attempts before anything touches the filesystem.
  for (const bad of ['..', '../..', 'shots/../..', 'a//b', '.', './x']) {
    assert.equal(fb.safeSubIn(root, bad).ok, false, `refused: ${bad}`);
  }
  // And the one the segment check cannot catch: every segment is innocent, and the link leads out.
  assert.equal(fb.safeSubIn(root, 'escape').ok, false, 'a symlink out of the workspace is refused');
  assert.equal(fb.safeSubIn(root, 'no-such-folder').ok, false);
  assert.equal(fb.safeSubIn(root, 'guide.pdf').ok, false, 'a file is not a folder to browse');
});

test('a folder row says how many entries are inside, counting direct children only', () => {
  // A recursive count would walk thousands of files to render one line, and "8 items" is what tells
  // you whether opening it is worth it anyway.
  const { root } = fixture();
  const subs = fb.subfolders(root, '');
  const byName = Object.fromEntries(subs.map((s) => [s.name, s]));
  assert.deepEqual(subs.map((s) => s.name).sort(), ['shots'], 'noise and the escape link are not folders to browse');
  assert.equal(byName.shots.count, 3, 'two pictures and a folder');
  assert.equal(byName.shots.folders, 1);
  assert.equal(byName.shots.rel, 'shots');
  assert.equal(fb.subfolders(path.join(root, 'shots'), 'shots')[0].rel, 'shots/raw', 'a nested folder keeps its full path');
});

test('noise is named, not guessed at', () => {
  // The workspace's own plumbing is tooling rather than content, and the three folder documents are
  // already rendered under the list. Everything else shows, whatever its extension.
  for (const n of ['node_modules', '.git', 'dev-ai-agents', '.hidden']) assert.ok(fb.isNoise(n, true), n);
  for (const n of ['cmd-tool-backup-doc.sh', 'docs.code-workspace', 'README.md', 'AGENTS.md', 'CLAUDE.md', '.DS_Store']) {
    assert.ok(fb.isNoise(n, false), n);
  }
  for (const n of ['guide.pdf', 'shot.png', 'demo.mp4', 'export.zip', 'notes.txt', 'data.json']) {
    assert.equal(fb.isNoise(n, false), false, `${n} is content`);
  }
  assert.equal(fb.isNoise('screenshots', true), false);
});

test('the trail back out names every level', () => {
  const trail = fb.crumbs('docs', 'a/b/c', 'Docs');
  assert.deepEqual(trail.map((c) => c.name), ['Docs', 'a', 'b', 'c']);
  assert.deepEqual(trail.map((c) => c.rel), ['', 'a', 'a/b', 'a/b/c']);
  assert.deepEqual(fb.crumbs('docs', '', 'Docs'), [{ name: 'Docs', rel: '' }]);
});

test('a file says what KIND it is, and every icon exists in the sprite', () => {
  // A missing symbol renders an empty box rather than failing, so the names are checked against the
  // sprite rather than trusted.
  const sprite = fs.readFileSync(path.join(APP, 'public/vendor/tabler-sprite.svg'), 'utf8');
  const cases = { 'a.pdf': 'file-type-pdf', 'a.docx': 'file-type-doc', 'a.csv': 'table', 'a.pptx': 'presentation',
    'a.html': 'world', 'a.png': 'photo', 'a.mp4': 'player-play', 'a.mp3': 'music', 'a.zip': 'file-zip',
    'a.md': 'file-text', 'a.yml': 'code', 'a.unknown-ext': 'file' };
  for (const [file, icon] of Object.entries(cases)) {
    assert.equal(fb.kindIcon(file), `tabler:${icon}`, file);
    assert.ok(sprite.includes(`id="${icon}"`), `the sprite carries ${icon}`);
  }
  for (const extra of ['folder', 'chevron-right']) assert.ok(sprite.includes(`id="${extra}"`), extra);
});

test('only the folder workspaces browse; the item ones are left alone', () => {
  // The ai-* workspaces list items by the name declared in their frontmatter, and a subdirectory
  // there is a skill they already handle — folders would be a second, competing idea of a row.
  assert.deepEqual([...fb.BROWSABLE].sort(), ['audio', 'designs', 'docs', 'images', 'specs', 'videos']);
  for (const k of ['ai-agents', 'ai-skills', 'ai-commands', 'ai-prompts']) assert.equal(fb.BROWSABLE.has(k), false, k);
});

test('specs browses, because a spec IS a folder', () => {
  // A spec is products/<project>/NNN-topic/ holding four files, and a product's constitution is
  // products/<project>/00-constitution.md — everything is two levels down. Without browsing, the
  // flat read of the top level found nothing and the page said "No specs here yet" on a workspace
  // that had twelve of them.
  assert.equal(fb.BROWSABLE.has('specs'), true);
});

test("a recording's poster is its thumbnail, never a row of its own", () => {
  // The rule that used to keep videos out of browsing altogether: a poster frame is an input to the
  // player, and listing it doubles the rows and makes half of them stills. Both shapes the recorder
  // writes are covered — `demo-poster.jpg` beside `demo.mp4`, and `demo.jpg` beside `demo.mp4`.
  const groups = new Map([
    ['demo', { name: 'demo', formats: [{ file: 'demo.mp4', path: 'demo.mp4', video: true }] }],
    ['demo-poster', { name: 'demo-poster', formats: [{ file: 'demo-poster.jpg', path: 'demo-poster.jpg', video: false }] }],
    ['talk', { name: 'talk', formats: [
      { file: 'talk.mp4', path: 'talk.mp4', video: true },
      { file: 'talk.jpg', path: 'talk.jpg', video: false }] }],
    // A picture that belongs to nothing is still a picture, and keeps its row.
    ['diagram', { name: 'diagram', formats: [{ file: 'diagram.png', path: 'diagram.png', video: false }] }],
  ]);
  fb.attachPosters(groups);
  assert.equal(groups.get('demo').poster, 'demo-poster.jpg');
  assert.equal(groups.has('demo-poster'), false, 'the poster is not a row');
  assert.equal(groups.get('talk').poster, 'talk.jpg');
  assert.deepEqual(groups.get('talk').formats.map((f) => f.file), ['talk.mp4'], 'and not a format to offer a button for');
  assert.equal(groups.get('diagram').poster, undefined);
  assert.equal(groups.has('diagram'), true);
});

test('the grid views show the picture itself, and the list does not', () => {
  // A folder of screenshots is a contact sheet; a column of identical photo icons answers none of the
  // questions you open it with. In a list a row is one line of text, and a thumbnail there would set
  // the row height for every file whether or not it has one.
  const css = fs.readFileSync(path.join(APP, 'public/css/components/project-rows.css'), 'utf8');
  assert.match(server, /class="fx-thumb\$\{it\.poster \? ' is-video' : ''\}"/);
  assert.match(server, /loading="lazy"/, 'a folder can hold two hundred of them');
  assert.match(css, /\.fx-thumb \{ display: none; \}/);
  assert.match(css, /html\[data-files-view\^="grid"\] \.fx-thumb \{[^}]*display: block/);
  assert.match(css, /aspect-ratio: 4 \/ 3/, 'a fixed box, so cards do not jump as shots load');
});

test('the layout and the filter are the list\'s own controls', () => {
  // List, or a grid one to six across — a folder of screenshots wants a contact sheet and a folder of
  // reports wants a list of names.
  assert.match(server, /const files = kind === 'files';/);
  assert.match(server, /pref = home \? 'ws-home-view' : files \? 'ws-files-view' : 'ws-rows-view'/);
  assert.match(server, /\['grid-6', 'Six across — the most files on one screen'\]/);
  const ui = fs.readFileSync(path.join(APP, 'public/ui.js'), 'utf8');
  assert.match(ui, /'ws-files-view': \{ attr: 'filesView', allowed: \['list', 'grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-5', 'grid-6'\] \}/);
  assert.match(server, /d\.dataset\.filesView=fv/, 'applied before first paint, like every other layout');

  // And what the folder is narrowed to. The first two are about ORDER: a folder of thirty subfolders
  // and a folder of thirty files want opposite things at the top.
  assert.match(server, /const FILE_FILTERS = \{/);
  for (const k of ['all', 'files-first', 'folders', 'files', 'documents', 'images', 'video', 'archives']) {
    assert.match(server, new RegExp(`(^|\\s|')${k.replace('-', '-')}'?: \\{ label:`, 'm'), `the filter offers ${k}`);
  }
  assert.match(server, /foldersFirst \? \(!!b\.folder - !!a\.folder\) : \(!!a\.folder - !!b\.folder\)/);
});

test('the listing draws folders first, as one row that opens', () => {
  assert.match(server, /if \(browsable\) items\.push\(\.\.\.filesBrowser\.subfolders\(dir, rel\)\)/);
  assert.match(server, /class="fx-row fx-folder"/);
  assert.match(server, /hx-get="\/fragments\/\$\{esc\(key\)\}\/items\?path=\$\{encodePath\(it\.rel\)\}"/);
  // Folders stay first whatever the sort: you scan a file list for a name and a folder list for
  // where to go next, and mixing them by date makes both slower.
  assert.match(server, /const kept = browsable \? matched\.filter\(\(it\) => filter\.keep\(it\)\) : matched;/);
});

test('the folder travels with every request the list makes', () => {
  // Otherwise page 2 of a subfolder is page 2 of the workspace root, and a delete throws you back to
  // the top.
  assert.match(server, /if \(rel\) qs\.set\('path', rel\)/, 'the pager and the sort carry it');
  assert.match(server, /listControlsHtml\(`\/fragments\/\$\{key\}\/items`, target, st, meta\.nounPlural, browsable \? kindFilter : null, \{/);
  assert.match(server, /if \(st\.kind && FILE_FILTERS\[st\.kind\] && st\.kind !== defaultKind\(key\)\) qs\.set\('kind', st\.kind\);/,
    'the filter travels with the folder, unless it is the workspace\'s own default');
  assert.match(server, /hx-include="find input\[name='path'\]"/, 'a refresh comes back to this folder');
  assert.match(lists, /const carriedInputs = /, 'the controls render it as a hidden input');
  assert.match(lists, /hx-get="\$\{esc\(url\)\}\?\$\{esc\(resetQs\.toString\(\)\)\}"/, 'Reset clears the search where you stand');
  assert.match(lists, /path: \(url\.searchParams\.get\('path'\) \|\| ''\)/, 'and it is read back off the query');
});

test('a file is reached by its path in the tree, not by its bare name', () => {
  // encodeURIComponent on the whole path turns the separators into %2F and the file server then
  // looks for one file whose name has slashes in it.
  assert.match(server, /const encodePath = \(rel\) => String\(rel\)\.split\('\/'\)\.map\(encodeURIComponent\)\.join\('\/'\)/);
  assert.match(server, /const filePath = \(key, rel\) => `\/files\/\$\{encodeURIComponent\(key\)\}\/\$\{encodePath\(rel\)\}`/);
  // Review and play take a path now, and check it the same way the listing does.
  assert.match(server, /pathname\.match\(\/\^\\\/fragments\\\/\(\[a-z0-9_-\]\+\)\\\/review\\\/\(\.\+\)\$\/\)/);
  assert.match(server, /pathname\.match\(\/\^\\\/fragments\\\/\(\[a-z0-9_-\]\+\)\\\/play\\\/\(\.\+\)\$\/\)/);
  const review = server.slice(server.indexOf('const reviewMatch'), server.indexOf('const cmdEditMatch'));
  assert.match(review, /filesBrowser\.safeSub\(key, dirRel\)/, 'the folder half is resolved, not trusted');
  assert.match(review, /!\/\^\[\^\/\\\\\]\+\$\/\.test\(name\)/, 'and the file half cannot be a path');
});

test('a text file is read in the modal, bounded', () => {
  // A browser shows a .md or a .yml as a download or as raw text in a tab; neither is reading it
  // where you found it, which is the point of a folder you can look inside.
  assert.match(server, /const REVIEW_TEXT_RE = /);
  assert.match(server, /REVIEW_TEXT_MAX/);
  const re = server.match(/const REVIEWABLE_RE = (\/[^\n]+\/i);/)[1];
  // eslint-disable-next-line no-eval
  const reviewable = eval(re);
  for (const f of ['a.md', 'a.txt', 'a.log', 'a.json', 'a.yml', 'a.csv', 'a.pdf', 'a.png']) {
    assert.ok(reviewable.test(f), `${f} can be reviewed`);
  }
  assert.equal(reviewable.test('a.zip'), false, 'an archive has nothing to show');
});

test('deleting reaches into the folder being browsed, and nowhere else', () => {
  assert.match(del, /filesBrowser\.safeSub\(workspace, form\.dir \|\| ''\)/);
  assert.match(del, /if \(!where\.ok\) return send/, 'a folder that does not resolve is refused');
  assert.match(del, /if \(inSub \|\| DOC_ARTIFACT_RE\.test\(name\) \|\| VIDEO_RE\.test\(name\)\)/,
    'inside a folder every row is a file, whatever its extension');
  assert.match(server, /"dir":"\$\{esc\(rel\)\}"/, 'the row tells the action which folder it was in');
});
