#!/usr/bin/env node
/**
 * Start a screen session through the host runner, from a shell line that runs on the host.
 *
 * A build that should hand over to Claude Code ends with `&& node screen-then.js <payload.json>`, so the
 * session starts only when the build succeeded, and as its own interactive session: the runner keeps a
 * command that starts with `exec` interactive, which a step inside the build's own piped session could not be.
 *
 * The payload is {session, dir, owner, cmd}, written by the dashboard into .screens/prompts/.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');

const ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..', '..');
const PORT = Number(process.env.SCREEN_RUNNER_PORT || 7681);

const file = process.argv[2];
if (!file) { console.error('usage: screen-then.js <payload.json>'); process.exit(2); }

let payload;
let token;
try {
  payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  token = fs.readFileSync(path.join(ROOT, '.screens', '.runner-token'), 'utf8').trim();
} catch (e) {
  console.error(`Could not start the session: ${e.message}`);
  process.exit(1);
}

const body = JSON.stringify(payload);
const req = http.request({ host: '127.0.0.1', port: PORT, path: '/start', method: 'POST',
  headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-runner-token': token } }, (res) => {
  let out = '';
  res.on('data', (d) => { out += d; });
  res.on('end', () => {
    if (res.statusCode === 200) {
      console.log(`Claude Code is starting in ${payload.dir} as the session ${payload.session}. Open it from Screens.`);
      try { fs.unlinkSync(file); } catch (_) { /* already gone */ }
      return process.exit(0);
    }
    console.error(`The runner did not start ${payload.session}: ${out.slice(0, 200)}`);
    return process.exit(1);
  });
});
req.on('error', (e) => { console.error(`The screen runner is not reachable: ${e.message}`); process.exit(1); });
req.end(body);
