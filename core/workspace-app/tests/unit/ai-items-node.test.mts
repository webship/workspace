/**
 * ai-items.sh runs the AI items engine with the machine's own `node`. The engine is the next to become TypeScript,
 * which Node.js strips itself from 22.18 on (the package's engines): an older Node.js is refused before it runs,
 * with the version it needs, as screen-host.sh does for the runner (#797).
 */
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.join(import.meta.dirname, '..', '..', '..', 'scripts', 'ai-items.sh');

test('ai-items.sh refuses a Node.js older than 22.18 and says which it needs; this one passes', () => {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-ai-items-node-'));
  const bin = path.join(box, 'bin');
  fs.mkdirSync(bin);
  // A Node.js 20: it answers its version, and the check it is asked to run says no.
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n[ "$1" = "--version" ] && { echo v20.11.0; exit 0; }\n[ "$1" = "-e" ] && exit 1\necho "the engine ran" ; exit 0\n', { mode: 0o755 });
  const old = spawnSync('bash', [SCRIPT, 'roles'], { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}/usr/bin${path.delimiter}/bin` } });
  assert.strictEqual(old.status, 1, old.stdout + old.stderr);
  assert.match(old.stderr, /node v20\.11\.0 is too old for this: it needs Node\.js 22\.18 or later\./);
  assert.doesNotMatch(old.stdout + old.stderr, /the engine ran/, 'the engine is not started');
  // The Node.js running this suite is new enough: the check lets it through to the engine.
  const here = spawnSync('bash', [SCRIPT, 'roles'], { encoding: 'utf8', env: { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` } });
  assert.doesNotMatch(here.stderr, /too old/, here.stderr);
  fs.rmSync(box, { recursive: true, force: true });
});
