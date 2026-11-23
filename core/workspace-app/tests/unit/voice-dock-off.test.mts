/**
 * With voice input off the voice dock does not listen (#760).
 *
 * `assistant.voice_input: false` removes the Assistant's microphone and, since #752, the field microphones. The dock
 * under the Assistant (public/assistant-avatar-ui.js) still showed Hold to talk and Keep listening, answered the Space
 * bar, and started the browser's recogniser, in en-US since the language it reads (WS_SPEECH.speechToText) is false
 * then. Now the server draws the two buttons hidden, the dock's script takes them out, and every way into listening
 * (the two buttons, the Space bar, a plugin's ear) stops at the setting first. The voice (mute) button stays: that is
 * voice out.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyConfig } from './_isolated-config.js';

const APP = path.join(import.meta.dirname, '..', '..');
const REPO = path.join(APP, '..', '..');
const script = fs.readFileSync(path.join(APP, 'public', 'assistant-avatar-ui.js'), 'utf8');

/* ---------------- the dock's script ---------------- */

test('the dock reads the setting from the page, and takes the two buttons out when it is off', () => {
  assert.match(script, /const voiceIn = !\(window\.WS_SPEECH && window\.WS_SPEECH\.voiceInput === false\);/,
    'off only when the page says so: a page that did not say keeps the buttons');
  assert.match(script, /if \(!voiceIn\) \{ micBtn\.remove\(\); keepBtn\.remove\(\); \}/, 'out, so a plugin\'s ear cannot show them again');
});

test('every way into listening stops at the setting first, a plugin\'s ear included', () => {
  assert.match(script, /function listen\(on\) \{\n    if \(!voiceIn\) return;\n    if \(ear\(\)\) \{ ear\(\)\.hold\(Boolean\(on\)\); return; \}/,
    'Hold to talk: before the ear and before the browser\'s recogniser');
  assert.match(script, /function keepListening\(on\) \{\n    if \(!voiceIn\) return;\n    if \(ear\(\)\) \{ ear\(\)\.keep\(Boolean\(on\)\); return; \}/,
    'Keep listening: the same');
  assert.match(script, /document\.addEventListener\('keydown', \(e\) => \{\n    if \(!voiceIn \|\| e\.code !== 'Space'/,
    'the Space bar is the page\'s own: not prevented, not listening');
  assert.match(script, /document\.addEventListener\('keyup', \(e\) => \{ if \(voiceIn && e\.code === 'Space'/);
});

test('the voice button stays: it is voice out, a setting of its own', () => {
  assert.doesNotMatch(script, /voiceIn[^\n]*dock-voice|voiceBtn\.remove\(\)/);
});

/* ---------------- the page, from a running dashboard ---------------- */

/** A dashboard on a throwaway workspace whose settings.yml says voice_input: <on>. */
async function dashboard(on: boolean): Promise<{ base: string; stop: () => Promise<void> }> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-voice-dock-'));
  fs.mkdirSync(path.join(root, 'core'), { recursive: true });
  copyConfig(path.join(REPO, 'core/config'), path.join(root, 'core/config'));
  const file = path.join(root, 'core/config/settings.yml');
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /^\s+voice_input: \w+/m, 'the shipped settings carry assistant.voice_input');
  fs.writeFileSync(file, text.replace(/^(\s+)voice_input: \w+/m, `$1voice_input: ${on}`));
  fs.symlinkSync(path.join(REPO, 'core/scripts'), path.join(root, 'core/scripts'));
  fs.symlinkSync(APP, path.join(root, 'core/workspace-app'));
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); });
  });
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), WORKSPACE_ROOT: root, HOME: root, WORKSPACE_PLUGINS_NO_RESTART: '1' };
  for (const k of ['WORKSPACE_PATH', 'WORKSPACE_SCRIPTS', 'WORKSPACE_CONFIG']) delete env[k];
  const proc: ChildProcess = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 20000);
    proc.stdout?.on('data', (d: Buffer) => { if (/listening/.test(String(d))) { clearTimeout(t); resolve(); } });
    proc.on('exit', (c) => { clearTimeout(t); reject(new Error(`server exited ${c}`)); });
  });
  return {
    base: `http://127.0.0.1:${port}`,
    stop: async () => {
      proc.kill();
      await new Promise((r) => { proc.on('exit', r); });
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/** The dock's three buttons as the page draws them, and what WS_SPEECH says. */
function dockOf(html: string): { voice: string; talk: string; keep: string; speech: { voiceInput?: boolean; speechToText?: unknown } } {
  const button = (cls: string): string => (html.match(new RegExp(`<button type="button" class="dock-btn ${cls}"[^>]*>`)) || [''])[0];
  const head = html.match(/<script>window\.WS_SPEECH=(\{.*?\});<\/script>/);
  return { voice: button('dock-voice'), talk: button('dock-talk'), keep: button('dock-mic'), speech: head ? JSON.parse(head[1] ?? '{}') : {} };
}

let off: { base: string; stop: () => Promise<void> };
let on: { base: string; stop: () => Promise<void> };
before(async () => { [off, on] = await Promise.all([dashboard(false), dashboard(true)]); });
after(async () => { await Promise.all([off?.stop(), on?.stop()]); });

test('voice input off: the page says so, and draws Hold to talk and Keep listening hidden; the voice button is there', async () => {
  const d = dockOf(await (await fetch(`${off.base}/`)).text());
  assert.strictEqual(d.speech.voiceInput, false);
  assert.strictEqual(d.speech.speechToText, false);
  assert.ok(d.talk && d.keep && d.voice, 'the dock is drawn');
  assert.match(d.talk, / hidden>$/, 'Hold to talk is hidden');
  assert.match(d.keep, / hidden>$/, 'Keep listening is hidden');
  assert.doesNotMatch(d.voice, /hidden/, 'the voice button is not');
});

test('voice input on: the two buttons are drawn as before', async () => {
  const d = dockOf(await (await fetch(`${on.base}/`)).text());
  assert.strictEqual(d.speech.voiceInput, true);
  assert.ok(d.talk && d.keep && d.voice);
  assert.doesNotMatch(d.talk, /hidden/);
  assert.doesNotMatch(d.keep, /hidden/);
});
