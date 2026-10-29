const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const providers = require('../../images-providers');
const ai = require('../../images-ai');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// A stand-in for every provider: it records each request and answers per path.
async function standIn(answer) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      seen.push({ url: req.url, headers: req.headers, raw, json: (() => { try { return JSON.parse(raw); } catch (_) { return null; } })() });
      const [status, body] = answer(req.url, raw);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const env = {
    GEMINI_INTERACTIONS_API: `${base}/gemini/interactions`,
    XAI_IMAGES_API: `${base}/xai/images/generations`,
    XAI_EDITS_API: `${base}/xai/images/edits`,
    STABILITY_CORE_API: `${base}/stability/core`,
    ANTHROPIC_MESSAGES_API: `${base}/anthropic/messages`,
    OPENAI_CHAT_API: `${base}/openai/chat`,
  };
  Object.assign(process.env, env);
  const https = require('https');
  const real = https.request;
  https.request = http.request;
  return { seen, close: () => { https.request = real; srv.close(); for (const k of Object.keys(env)) delete process.env[k]; } };
}

test('every provider keeps the registry contract', () => {
  assert.deepEqual(providers.ORDER, ['openai', 'gemini', 'xai', 'stability', 'anthropic', 'claude-code']);
  for (const p of providers.list()) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.label, 'string');
    assert.ok(Array.isArray(p.kinds) && p.kinds.length, p.id);
    const a = p.available();
    assert.equal(typeof a.ok, 'boolean', p.id);
    if (!a.ok) assert.match(a.why, /settings\.yml|claude CLI/, p.id);
    for (const kind of p.kinds) {
      if (kind === 'generate' || kind === 'edit') {
        assert.ok(p.models[p.defaultModel], `${p.id} default model`);
        assert.ok(Object.keys(p.sizes).length, `${p.id} sizes`);
        assert.ok(p.qualities === null || p.qualities.length, `${p.id} qualities`);
      }
      if (kind === 'generate') assert.ok(p.async || typeof p.generate === 'function', `${p.id} generate`);
      if (kind === 'edit') assert.ok(p.async || typeof p.edit === 'function', `${p.id} edit`);
      if (kind === 'svg') assert.ok(p.async || typeof p.svg === 'function', `${p.id} svg`);
    }
  }
  assert.equal(providers.pick('nope', 'generate').id, 'openai');
  assert.equal(providers.pick('stability', 'generate').id, 'stability');
  assert.equal(providers.pick('stability', 'edit').id, 'openai', 'Stability does not edit');
  assert.deepEqual(providers.list('svg').map((p) => p.id), ['openai', 'gemini', 'anthropic', 'claude_code_cli']);
});

test('a provider with a placeholder key is unavailable, shown disabled with the key to set, and nothing is sent', async () => {
  for (const id of ['gemini', 'xai', 'stability', 'anthropic']) {
    const p = providers.get(id);
    assert.equal(p.key(), '', `${id} reads the shipped placeholder as no key`);
    assert.deepEqual(p.available(), { ok: false, why: `set ai_providers.${id}.api_key in settings.yml` });
  }
  const html = ai.providerSelectHtml('generate', 'gemini');
  assert.match(html, /<option value="gemini" disabled>Google Gemini \(set ai_providers\.gemini\.api_key in settings\.yml\)<\/option>/);
  const s = await standIn(() => [200, {}]);
  try {
    assert.equal((await ai.generate({ prompt: 'x', provider: 'stability' })).status, 400, 'no confirm, no call');
    const r = await ai.generate({ prompt: 'x', provider: 'stability', confirm: 'yes' });
    assert.equal(r.status, 503);
    assert.match(r.error, /ai_providers\.stability\.api_key/);
    assert.equal(s.seen.length, 0);
  } finally {
    s.close();
  }
});

test('Gemini: the Interactions request, the key in x-goog-api-key, and the image read from the output steps', async () => {
  const s = await standIn(() => [200, { steps: [{ type: 'thought' }, { type: 'model_output', content: [{ type: 'text', text: 'here' }, { type: 'image', mime_type: 'image/png', data: PNG.toString('base64') }] }] }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gem-'));
  try {
    const r = await ai.generate({ prompt: 'A lake', provider: 'gemini', shape: 'landscape', quality: 'medium', count: '1', name: 'lake', confirm: 'yes' },
      { key: 'AIzaTESTKEY', dir, describe: false });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.cost, null, 'no published figure, so no made-up cost');
    const call = s.seen[0];
    assert.equal(call.url, '/gemini/interactions');
    assert.equal(call.headers['x-goog-api-key'], 'AIzaTESTKEY');
    assert.equal(call.headers.authorization, undefined);
    assert.deepEqual(call.json, { model: 'gemini-nano-banana-2.1', input: [{ type: 'text', text: 'A lake' }],
      response_format: { type: 'image', aspect_ratio: '16:9', image_size: '2K' } });
    assert.ok(fs.readFileSync(path.join(dir, 'lake.png')).equals(PNG));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'lake.png.json'), 'utf8')).provider, 'Google Gemini');
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('xAI: generate and edit with a Bearer key, base64 asked for, the edit image as a data URL', async () => {
  const s = await standIn(() => [200, { data: [{ b64_json: PNG.toString('base64') }] }]);
  try {
    const xai = providers.get('xai');
    const g = await xai.generate({ model: 'grok-imagine-image-2.0', prompt: 'A fox', n: 2 }, 'xai-TESTKEY');
    assert.equal(g.images.length, 1);
    assert.equal(s.seen[0].url, '/xai/images/generations');
    assert.equal(s.seen[0].headers.authorization, 'Bearer xai-TESTKEY');
    assert.deepEqual(s.seen[0].json, { model: 'grok-imagine-image-2.0', prompt: 'A fox', n: 2, response_format: 'b64_json' });
    const e = await xai.edit({ model: 'grok-imagine-image-2.0', prompt: 'warmer' }, { name: 'a.png', type: 'image/png', data: PNG }, 'xai-TESTKEY');
    assert.ok(e.image.equals(PNG));
    assert.equal(s.seen[1].url, '/xai/images/edits');
    assert.deepEqual(s.seen[1].json.image, { type: 'image_url', url: `data:image/png;base64,${PNG.toString('base64')}` });
  } finally {
    s.close();
  }
});

test('Stability: multipart with prompt, aspect ratio and PNG, JSON asked for, one call per image', async () => {
  const s = await standIn(() => [200, { image: PNG.toString('base64'), finish_reason: 'SUCCESS' }]);
  try {
    const st = providers.get('stability');
    const r = await st.generate({ prompt: 'A hill', size: '9:16', n: 2 }, 'sk-STABTEST');
    assert.equal(r.images.length, 2);
    assert.equal(r.cost.toFixed(2), '0.06');
    const call = s.seen[0];
    assert.equal(call.headers.authorization, 'Bearer sk-STABTEST');
    assert.equal(call.headers.accept, 'application/json');
    assert.match(call.headers['content-type'], /^multipart\/form-data; boundary=/);
    const raw = call.raw.toString('latin1');
    assert.match(raw, /name="prompt"\r\n\r\nA hill\r\n/);
    assert.match(raw, /name="aspect_ratio"\r\n\r\n9:16\r\n/);
    assert.match(raw, /name="output_format"\r\n\r\npng\r\n/);
  } finally {
    s.close();
  }
});

test('Anthropic and OpenAI SVG source: the key in its own header, the text read back', async () => {
  const s = await standIn((url) => (url.includes('anthropic')
    ? [200, { content: [{ type: 'text', text: '{"svg":"<svg/>"}' }] }]
    : [200, { choices: [{ message: { content: '{"svg":"<svg/>"}' } }], usage: { prompt_tokens: 1000, completion_tokens: 2000 } }]));
  try {
    const a = await providers.get('anthropic').svg({ system: 'sys', messages: [{ role: 'user', content: 'draw' }], model: 'claude-haiku-5-5' }, 'sk-ant-TEST');
    assert.equal(a.text, '{"svg":"<svg/>"}');
    const call = s.seen[0];
    assert.equal(call.headers['x-api-key'], 'sk-ant-TEST');
    assert.equal(call.headers['anthropic-version'], '2023-06-01');
    assert.deepEqual([call.json.model, call.json.system, call.json.messages[0].content], ['claude-haiku-5-5', 'sys', 'draw']);
    const o = await providers.get('openai').svg({ system: 'sys', messages: [{ role: 'user', content: 'draw' }], model: 'gpt-5.4-mini' }, 'sk-TEST');
    assert.equal(o.cost.toFixed(6), (1000 * 0.75 / 1e6 + 2000 * 4.5 / 1e6).toFixed(6));
    assert.deepEqual(s.seen[1].json.response_format, { type: 'json_object' });
  } finally {
    s.close();
  }
});

test('an error from a provider is shown with any key masked', async () => {
  const s = await standIn(() => [401, { error: { message: 'Incorrect API key provided: sk-abcdef123456 (Bearer sk-abcdef123456)' } }]);
  try {
    await assert.rejects(providers.get('xai').generate({ prompt: 'x', n: 1 }, 'sk-abcdef123456'), (e) => {
      assert.doesNotMatch(e.message, /abcdef123456/);
      assert.match(e.message, /sk-…/);
      return true;
    });
  } finally {
    s.close();
  }
});

test('Claude Code: a session from a 0600 prompt file, no prompt text on the shell line, limited tools', async () => {
  const cc = providers.get('claude_code_cli');
  const calls = [];
  const start = async (action, payload) => { calls.push({ action, payload }); return { ok: true }; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
  const secret = "a lighthouse; rm -rf ~ $(whoami) `id` 'quoted'";
  try {
    const r = await cc.startSession({ kind: 'generate', name: 'lighthouse', dir, prompt: secret, pixels: [1024, 1024], palette: 'blue #0074e0' }, start);
    assert.equal(r.ok, true, r.error);
    const { cmd, session } = calls[0].payload;
    assert.equal(calls[0].action, 'start');
    assert.equal(session, 'images--claude-lighthouse');
    assert.doesNotMatch(cmd, /lighthouse;|whoami|rm -rf|quoted/, 'the prompt never reaches the line');
    assert.match(cmd, /^claude -p "\$\(cat '[^']+\.txt'\)" /);
    assert.match(cmd, /--allowedTools Write Read --disallowedTools Bash WebFetch WebSearch/);
    assert.match(cmd, /&& node '[^']+images-claude-finish\.js' '[^']+\.job\.json'$/);
    const promptFile = cmd.match(/cat '([^']+)'/)[1];
    assert.equal(fs.statSync(promptFile).mode & 0o777, 0o600);
    const prompt = fs.readFileSync(promptFile, 'utf8');
    assert.match(prompt, /a lighthouse; rm -rf/);
    assert.match(prompt, /lighthouse\.svg: one self-contained SVG with viewBox="0 0 1024 1024" and no width or height/);
    assert.match(prompt, /Do not run any commands/);
    const job = cmd.match(/'([^']+\.job\.json)'$/)[1];
    assert.equal(fs.statSync(job).mode & 0o777, 0o600);
    fs.rmSync(promptFile, { force: true });
    fs.rmSync(job, { force: true });
    fs.rmSync(path.join(path.dirname(path.dirname(promptFile)), `${session}.cwd`), { force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Claude Code in the forms: no charge, watched on Screens, the confirm dialog still asked, SVG-only for edits', () => {
  const p = ai.plan({ prompt: 'a lighthouse', provider: 'claude_code_cli', count: '3' });
  assert.deepEqual([p.provider, p.n, p.estimate, p.quality], ['claude_code_cli', 1, 0, null]);
  const html = ai.planHtml(p);
  assert.match(html, /No API charge: it uses your own Claude Code login\./);
  assert.match(html, /watch it on Screens/);
  assert.match(html, /hx-trigger="confirmed-remove"/);
  assert.deepEqual(ai.editProviders(true).map((x) => x.id), ['claude_code_cli']);
  assert.ok(!ai.editProviders(false).some((x) => x.id === 'claude_code_cli'));
  assert.match(read('actions/images.js'), /if \(r\.async\) return send\(startedHtml\(r\.session/);
});

test('the finish step sanitises the SVG and writes its records', () => {
  const finish = require('../../scripts/images-claude-finish');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccf-'));
  try {
    fs.writeFileSync(path.join(dir, 'pic.svg'), '<svg viewBox="0 0 10 10" onload="x()"><script>x()</script><rect width="5" height="5" fill="#0074e0"/></svg>');
    fs.writeFileSync(path.join(dir, 'pic.claude.json'), JSON.stringify({ summary: 'A blue square.', alt: 'Blue square' }));
    const job = path.join(dir, 'pic.job.json');
    fs.writeFileSync(job, JSON.stringify({ kind: 'generate', name: 'pic', dir, prompt: 'a square', pixels: [10, 10], png: false }));
    assert.equal(finish.main(job), 0);
    const svg = fs.readFileSync(path.join(dir, 'pic.svg'), 'utf8');
    assert.doesNotMatch(svg, /script|onload/);
    assert.match(svg, /<rect /);
    const side = JSON.parse(fs.readFileSync(path.join(dir, 'pic.svg.json'), 'utf8'));
    assert.deepEqual([side.provider, side.summary, side.alt, side.prompt], ['claude_code_cli', 'A blue square.', 'Blue square', 'a square']);
    assert.ok(!fs.existsSync(path.join(dir, 'pic.claude.json')));
    assert.ok(!fs.existsSync(job));
    assert.match(fs.readFileSync(path.join(dir, 'pic.md'), 'utf8'), /- \*\*Provider:\*\* claude_code_cli/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
