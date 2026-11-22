/**
 * The small microphone beside every text field is not drawn when voice input is switched off (#741).
 *
 * speech.js hands the page `fieldMic: false` when `voice_input` is false. mic.js read it as
 * `fieldMic || null`, so the `false` became "not said" and every field still got its microphone. This runs the
 * built public/mic.js, the file the page loads, against a page made of stand-ins, with the setting on, off and
 * not given.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SCRIPT = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'public', 'mic.js'), 'utf8');

/** A page with `n` text fields, the recogniser `hasRecogniser`, and WS_SPEECH as given. Answers how many fields got a microphone. */
function micsDrawn(wsSpeech: unknown, { n = 3, hasRecogniser = true }: { n?: number; hasRecogniser?: boolean } = {}): number {
  let wrapped = 0;
  const listeners: Record<string, (() => void)[]> = {};
  const element = (): Record<string, unknown> => ({ dataset: {}, setAttribute() {}, appendChild() {}, classList: { add() {}, remove() {} } });
  const fields = Array.from({ length: n }, () => ({
    dataset: {} as Record<string, string>, readOnly: false, disabled: false, labels: [], isConnected: true,
    closest: () => null, getAttribute: () => null,
    parentNode: { insertBefore: () => { wrapped += 1; } },
  }));
  const document = {
    documentElement: { lang: 'en' },
    addEventListener: (type: string, fn: () => void) => { (listeners[type] ||= []).push(fn); },
    querySelectorAll: (sel: string) => (sel.includes('input[type="text"]') ? fields : []),
    createElement: element,
    body: { addEventListener() {} },
  };
  const window = { SpeechRecognition: hasRecogniser ? class {} : undefined, WS_SPEECH: wsSpeech };
  vm.runInNewContext(SCRIPT, { window, document });
  for (const fn of listeners.DOMContentLoaded || []) fn();
  return wrapped;
}

test('voice input on: every text field gets its microphone', () => {
  assert.strictEqual(micsDrawn({ fieldMic: { lang: 'en-US', interimResults: true } }), 3);
});

test('voice input off: no field gets one', () => {
  assert.strictEqual(micsDrawn({ fieldMic: false }), 0);
});

test('a page that did not say (no WS_SPEECH, or no fieldMic) keeps the browser\'s defaults, and a browser with no recogniser draws none', () => {
  assert.strictEqual(micsDrawn(undefined), 3);
  assert.strictEqual(micsDrawn({}), 3);
  assert.strictEqual(micsDrawn({ fieldMic: { lang: 'en-US' } }, { hasRecogniser: false }), 0);
});
