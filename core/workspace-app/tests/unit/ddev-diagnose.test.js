/**
 * The four questions worth asking before guessing at a broken project.
 *
 * Docker and the network, the certificate the browser will not trust, the ports something else is
 * holding, and whether the database volume on disk is the engine and version the config asks for.
 * DDEV answers all four and the dashboard offered none of them, so the moment you need them is the
 * moment you go looking for a command name.
 *
 * All four READ. None of them changes anything, which is why they are one group and why none is
 * behind the confirm dialog — a diagnostic you hesitate to run is not a diagnostic.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../..');
const ddev = fs.readFileSync(path.join(APP, 'ddev.js'), 'utf8');
const actions = fs.readFileSync(path.join(APP, 'actions/ddev.js'), 'utf8');
const server = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');

const FOUR = {
  'ddev-diagnose': ['utility', 'diagnose'],
  'ddev-tls-diagnose': ['utility', 'tls-diagnose'],
  'ddev-port-diagnose': ['utility', 'port-diagnose'],
  'ddev-db-match': ['utility', 'check-db-match'],
};

test('each is the CLI command it claims to be', () => {
  // The `utility` namespace, as `ddev utility --help` lists it on v1.25 — not the older `ddev debug`.
  for (const [action, args] of Object.entries(FOUR)) {
    const line = ddev.match(new RegExp(`'/actions/${action}':[^\\n]*`))[0];
    assert.ok(line.includes(`args: ['${args[0]}', '${args[1]}']`), `${action} runs ${args.join(' ')}`);
    assert.match(actions, new RegExp(`'/actions/${action}': ddev_verb,`), action);
  }
});

test('none of them is destructive, and none needs the project running', () => {
  // They read. And the moment you want them most is when the project will NOT start, so gating them
  // on a running project would take them away exactly then.
  for (const action of Object.keys(FOUR)) {
    const line = ddev.match(new RegExp(`'/actions/${action}':[^\\n]*`))[0];
    assert.ok(!line.includes('destructive'), `${action} is not destructive`);
    assert.ok(!line.includes('needsRunning'), `${action} answers even when the project will not start`);
  }
});

test('the menu says what each one answers, not what it is called', () => {
  // "Diagnose the ports" is a question somebody has; `ddev utility port-diagnose` is a command name
  // they would have to already know.
  assert.match(server, /Diagnose — Docker, network, HTTPS/);
  assert.match(server, /Diagnose the certificate/);
  assert.match(server, /Diagnose the ports/);
  assert.match(server, /Does the database match the config\?/);
  assert.match(server, /What else on this machine is holding the ports DDEV needs/);
});
