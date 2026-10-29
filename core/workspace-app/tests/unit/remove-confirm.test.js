/**
 * Removing a project asks for its name.
 *
 * The form had a tick-box, "Yes, I am sure", which anyone clicks without reading. GitHub asks for the repository's
 * name and GitLab ties the typed name to its highest severity; removing a project deletes its folder and its
 * database, so it gets the same. The old field is still accepted from callers that predate the form, and a typed
 * name that does not match is refused whatever else came with it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.js'), 'utf8');
const form = server.slice(server.indexOf("const rm = pathname.match(/^\\/fragments\\/projects\\/remove-form"));
const action = server.slice(server.indexOf("if (pathname === '/actions/remove') {"), server.indexOf("if (pathname === '/actions/hostname-add'"));

test('the form asks for the name typed out, and the button stays off until it matches exactly', () => {
  assert.match(form, /name="confirm_name" autocomplete="off" spellcheck="false" autocapitalize="off"/);
  assert.match(form, /Type <code>\$\{esc\(rm\[2\]\)\}<\/code> to confirm/);
  assert.match(form, /oninput="var b=this\.form\.querySelector\('\.remove-go'\);var ok=this\.value===this\.dataset\.expect;b\.disabled=!ok;/);
  assert.match(form, /class="uk-button uk-button-danger uk-button-small remove-go" type="submit" disabled aria-disabled="true"/);
  assert.ok(!/name="sure"/.test(form), 'the tick-box is gone from the form');
});

test('the name is tied to the field with a label and a description', () => {
  assert.match(form, /<label class="uk-form-label" for="remove-confirm-name">/);
  assert.match(form, /aria-describedby="remove-confirm-help"/);
  assert.match(form, /id="remove-confirm-help">The button stays off until the name matches exactly\./);
});

test('a name that does not match is refused, and so is nothing at all', () => {
  assert.match(action, /typed !== null && typed !== String\(form\.projectName\)/);
  assert.match(action, /The name typed does not match the project, so nothing was removed\./);
  assert.match(action, /if \(typed === null && form\.sure !== 'yes'\)/, 'a caller that predates the form still has to say it is sure');
});
