const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');

// The dashboard runs htmx 4.0.0, which reads a trigger's `from:` otherwise than htmx 2: `from:find input` attaches no
// listener (#870), and a form whose only triggers name elements that way sends nothing (webship/workspace-jira#51).
// An event bubbles to the form, so a trigger on the form itself needs no `from:`; `from:body` and `from:document` stay.
const SOURCES = fs.readdirSync(APP).filter((f) => /\.(js|mts)$/.test(f))
  .concat(fs.readdirSync(path.join(APP, 'actions')).filter((f) => /\.(js|mts)$/.test(f)).map((f) => path.join('actions', f)));

test('no hx-trigger names an element with from:find, from:closest, from:next or from:previous', () => {
  const found = [];
  for (const f of SOURCES) {
    const text = fs.readFileSync(path.join(APP, f), 'utf8');
    for (const m of text.matchAll(/hx-trigger="([^"]*)"/g)) {
      if (/from:(find|closest|next|previous)\b/.test(m[1])) found.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepStrictEqual(found, []);
});

test('the add-on and mailbox searches submit on submit, which Enter in their box does', () => {
  for (const f of ['ddev-addons-page.js', 'ddev-mail-page.js']) {
    const text = fs.readFileSync(path.join(APP, f), 'utf8');
    assert.match(text, /hx-trigger="submit">/, f);
    assert.match(text, /<button class="uk-button uk-button-default uk-button-small" type="submit">Search<\/button>/, `${f} keeps its submit button`);
  }
});
