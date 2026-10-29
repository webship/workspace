/**
 * The note on a folder, and the name you would rather call it.
 *
 * The note lives IN the folder (`.workspace-note`), which is the choice `.jira-project` already made
 * here — so a project renamed, moved or cloned takes its note with it, one removed takes its note away,
 * and a `claude` session started there can read it. A central index would have to be told about every
 * one of those events, and would be wrong the first time somebody moved a folder in a terminal.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const notes = require('../../notes');
const { folderOf } = require('../../actions/notes');

const server = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ws-note-'));

test('a note is one file with two fields, written as a titled markdown note', () => {
  const dir = tmp();
  notes.writeNote(dir, { title: 'Gleap widget spike', body: 'Reproducing WEBSHIP-1925.' });
  // A document, not a config format: an agent that opens it gets something to read.
  assert.equal(
    fs.readFileSync(path.join(dir, notes.NOTE_FILE), 'utf8'),
    '# Gleap widget spike\n\nReproducing WEBSHIP-1925.\n',
  );
  assert.deepEqual(notes.readNote(dir), { title: 'Gleap widget spike', body: 'Reproducing WEBSHIP-1925.' });
});

test('either half can stand alone', () => {
  const dir = tmp();
  notes.writeNote(dir, { title: '', body: 'no heading, all note' });
  assert.deepEqual(notes.readNote(dir), { title: '', body: 'no heading, all note' });
  notes.writeNote(dir, { title: 'name only', body: '' });
  assert.deepEqual(notes.readNote(dir), { title: 'name only', body: '' });
});

test('emptying both fields removes the file', () => {
  // A note nobody wants should not need a second control to get rid of, and a file holding only
  // whitespace would keep the row marked as annotated.
  const dir = tmp();
  notes.writeNote(dir, { title: 'x', body: 'y' });
  notes.writeNote(dir, { title: '  ', body: '\n' });
  assert.equal(fs.existsSync(path.join(dir, notes.NOTE_FILE)), false);
  assert.equal(notes.hasNote(dir), false);
  assert.deepEqual(notes.readNote(dir), { title: '', body: '' });
});

test('a title is one line, whatever was pasted into the field', () => {
  const dir = tmp();
  notes.writeNote(dir, { title: '#  Hash and\nnewlines  ', body: '' });
  assert.equal(notes.readNote(dir).title, 'Hash and newlines');
  // And it cannot push a project row sideways.
  notes.writeNote(dir, { title: 'x'.repeat(200), body: '' });
  assert.equal(notes.readNote(dir).title.length, notes.TITLE_MAX);
});

test('control characters never reach a title attribute', () => {
  // The note is rendered into `title=` and read out by a screen reader; an escape sequence pasted from
  // a terminal line would be neither. Newlines survive, because a note is prose.
  const dir = tmp();
  notes.writeNote(dir, { title: '', body: 'onetwo[31m\nthree' });
  assert.equal(notes.readNote(dir).body, 'onetwo[31m\nthree');
});

test('displayName falls back to the folder name', () => {
  const dir = tmp();
  assert.equal(notes.displayName(dir, 'v11x00b1gleap'), 'v11x00b1gleap');
  notes.writeNote(dir, { title: 'Gleap widget spike', body: '' });
  assert.equal(notes.displayName(dir, 'v11x00b1gleap'), 'Gleap widget spike');
});

test('a folder is only ever one inside the workspace it names', () => {
  // The workspace and the project come from the browser; a path built from them unchecked would write
  // .workspace-note anywhere `..` can reach.
  assert.equal(folderOf({ workspace: 'no-such-workspace', projectName: 'x' }), null);
  assert.equal(folderOf({ workspace: 'test', projectName: '../../etc' }), null);
  assert.equal(folderOf({ workspace: 'test', projectName: 'definitely-not-here-1234' }), null);
  // And a workspace with no project is the workspace folder itself, which does exist.
  assert.ok(folderOf({ workspace: 'test' }));
});

test('the tooltip is cut to what a tooltip can carry', () => {
  const tip = notes.noteTooltip({ title: 'T', body: 'word '.repeat(200) });
  assert.ok(tip.length <= 301, 'trimmed');
  assert.match(tip, /…$/, 'and marked, so it reads as cut rather than as all there is');
  assert.equal(notes.noteTooltip({ title: 'short', body: '' }), 'short');
  assert.equal(notes.noteTooltip({ title: '', body: '' }), '');
});

test('the row shows the note, and keeps the folder name beside a custom one', () => {
  // The folder's own name is what `cd` takes, what DDEV calls the project and what every command on
  // the row needs — so a custom name is shown WITH it, never instead of it.
  assert.match(server, /const rawLabel = note\.title \|\| p;/);
  assert.match(server, /class="pcard-chip pcard-slug"/);
  assert.match(server, /title="\$\{esc\(tip \|\| rawLabel\)\}"/);
  assert.match(server, /const sayFolder = note\.title && !note\.title\.toLowerCase\(\)\.includes\(p\.toLowerCase\(\)\);/,
    'the folder is said beside a custom name only when the name does not already hold it');
});

test('the pen that edits it is in the card corner, not on the name line', () => {
  // The name is the one thing the eye scans a list of thirty cards for; a control sitting in the
  // middle of it reads as part of the name. The pen belongs in the card's bottom-right cluster.
  const card = server.slice(server.indexOf('<div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small project-row">'));
  const titleLine = card.slice(card.indexOf('project-title-row'), card.indexOf('project-title-status'));
  assert.ok(!titleLine.includes('project-note'), 'no pen on the name line');
  assert.match(server, /const noteCorner = `<span class="project-note-corner">/);
});

test('the cluster rides in the last row of controls, and reserves nothing', () => {
  // It used to float in the corner, which had to be paid for with reserved padding on EVERY action
  // row — and that padding pushed `More` onto a line of its own while the row still had room for it.
  // As a flex item pushed right it costs nothing until the row is genuinely full.
  assert.match(server, /\$\{testBadge\}\$\{runningBadge\}\s*\$\{noteCorner\}/, 'the cluster ends the facts row of the card');
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/components/project-rows.css'), 'utf8');
  assert.match(css, /\.project-note-corner \{[^}]*margin-left: auto/);
  assert.ok(!/\.project-row \.project-actions \{[^}]*padding-right/.test(css), 'no reserved gutter');
});

test('the pen out-specifies UIKit, which is linked after us', () => {
  // A bare .project-note ties with UIKit's own .uk-button-link, and UIKit wins the tie — silently.
  const css = fs.readFileSync(path.join(__dirname, '../../public/css/components/project-rows.css'), 'utf8');
  assert.match(css, /\.project-note-corner \.project-note \{/);
  assert.ok(!/^\.project-note \{/m.test(css), 'not a single class of ours against UIKit');
});
