const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ai = require('../../images-ai');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('the plan checks every choice and estimates the cost before anything is sent', () => {
  const p = ai.plan({ prompt: 'A calm blue lake', model: 'gpt-image-2.5-sunburst', shape: 'landscape', quality: 'medium', count: '3', name: 'Lake 1' });
  assert.deepEqual([p.model, p.size, p.quality, p.n, p.name], ['gpt-image-2.5-sunburst', '1536x1024', 'medium', 3, 'Lake-1']);
  assert.equal(p.estimate.toFixed(3), ((0.053 + ai.DESCRIBE_ESTIMATE) * 3).toFixed(3));
  const odd = ai.plan({ prompt: 'x', model: 'dall-e-9', shape: 'huge', quality: 'max', count: '99' });
  assert.deepEqual([odd.model, odd.size, odd.quality, odd.n], ['gpt-image-2.5-flare', '1024x1024', 'low', 4]);
  assert.equal(ai.plan({ prompt: '  ' }).ok, false);
  assert.match(ai.planHtml(p), /hx-trigger="confirmed-remove"/);
  assert.match(ai.planHtml(p), /&quot;confirm&quot;:&quot;yes&quot;/);
});

test('nothing is generated without confirm=yes, nor without a real key', async () => {
  assert.equal((await ai.generate({ prompt: 'x' })).status, 400);
  const noKey = await ai.generate({ prompt: 'x', confirm: 'yes' }, { key: '' });
  assert.equal(noKey.ok, false);
  assert.ok([503].includes(noKey.status) || /settings\.yml/.test(noKey.error));
});

test('a run saves each image with a sidecar and reports what it cost, against a stand-in for OpenAI', async () => {
  let seen = null;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen = { auth: req.headers.authorization, body: JSON.parse(body), url: req.url };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }], usage: { output_tokens: 400, input_tokens: 20 } }));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.OPENAI_IMAGES_API = `http://127.0.0.1:${srv.address().port}/v1/images/generations`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  try {
    // The stand-in is plain http, so the request module is swapped for this one run.
    const https = require('https');
    const realRequest = https.request;
    https.request = http.request;
    const r = await ai.generate({ prompt: 'A small test square', quality: 'low', count: '1', name: 'test', confirm: 'yes' }, { key: 'sk-test-key', dir });
    https.request = realRequest;
    assert.equal(r.ok, true, r.error);
    assert.deepEqual(r.made, ['generated/test.png']);
    assert.equal(seen.auth, 'Bearer sk-test-key');
    assert.deepEqual([seen.body.model, seen.body.size, seen.body.quality, seen.body.n], ['gpt-image-2.5-flare', '1024x1024', 'low', 1]);
    assert.ok(fs.readFileSync(path.join(dir, 'test.png')).equals(PNG));
    const side = JSON.parse(fs.readFileSync(path.join(dir, 'test.png.json'), 'utf8'));
    assert.equal(side.prompt, 'A small test square');
    assert.equal(side.model, 'gpt-image-2.5-flare');
    assert.equal(r.cost.toFixed(6), (400 * 30 / 1e6 + 20 * 5 / 1e6).toFixed(6));
  } finally {
    delete process.env.OPENAI_IMAGES_API;
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the key never reaches the page, a URL or a log line', () => {
  const src = read('images-ai.js');
  assert.match(read('images-providers/openai.js'), /Authorization: `Bearer \$\{key\}`/);
  assert.doesNotMatch(src, /console\.(log|error)/);
  assert.match(read('images-providers/http.js'), /replace\(\/sk-\[A-Za-z0-9_-\]\+\/g, 'sk-…'\)/);
  assert.doesNotMatch(ai.formHtml(), /sk-[A-Za-z0-9]{8}/);
  assert.match(read('images-page.js'), /btn\('secondary', 'bolt', 'Generate with AI'/);
  assert.match(read('actions/images.js'), /if \(form\.confirm !== 'yes'\) \{\n\s+const p = ai\.plan\(form\);/);
});

// A stand-in for OpenAI that records each request and answers per path.
async function standIn(answer) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      seen.push({ url: req.url, auth: req.headers.authorization, type: req.headers['content-type'], raw });
      const [status, body] = answer(req.url, raw);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  process.env.OPENAI_IMAGES_API = `${base}/v1/images/generations`;
  process.env.OPENAI_EDITS_API = `${base}/v1/images/edits`;
  process.env.OPENAI_CHAT_API = `${base}/v1/chat/completions`;
  const https = require('https');
  const real = https.request;
  https.request = http.request;
  return { seen, close: () => { https.request = real; srv.close(); delete process.env.OPENAI_IMAGES_API; delete process.env.OPENAI_EDITS_API; delete process.env.OPENAI_CHAT_API; } };
}

const DESCRIBED = { choices: [{ message: { content: JSON.stringify({ summary: 'A small blue square on white.', alt: 'Blue square' }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };

test('a generated image keeps its prompt in a readable .md, with an AI summary and alt text from a vision call', async () => {
  const s = await standIn((url) => (url.includes('chat') ? [200, DESCRIBED]
    : [200, { data: [{ b64_json: PNG.toString('base64') }], usage: { output_tokens: 400, input_tokens: 20 } }]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  try {
    const r = await ai.generate({ prompt: 'A small test square', quality: 'low', count: '1', name: 'sq', confirm: 'yes' }, { key: 'sk-test-key', dir });
    assert.equal(r.ok, true, r.error);
    const chat = s.seen.find((x) => x.url.includes('chat'));
    const body = JSON.parse(chat.raw.toString());
    assert.equal(chat.auth, 'Bearer sk-test-key');
    assert.equal(body.model, ai.VISION_MODEL);
    assert.deepEqual(body.response_format, { type: 'json_object' });
    const img = body.messages[1].content.find((c) => c.type === 'image_url');
    assert.match(img.image_url.url, /^data:image\/png;base64,/);
    assert.equal(img.image_url.detail, 'low');
    const side = JSON.parse(fs.readFileSync(path.join(dir, 'sq.png.json'), 'utf8'));
    assert.deepEqual([side.summary, side.alt, side.described_by], ['A small blue square on white.', 'Blue square', ai.VISION_MODEL]);
    const md = fs.readFileSync(path.join(dir, 'sq.md'), 'utf8');
    assert.match(md, /^<!-- images: how this image was made -->\n# sq\n\n!\[Blue square\]\(\.\/sq\.png\)/);
    assert.match(md, /A small blue square on white\./);
    assert.match(md, /- \*\*Prompt:\*\* A small test square/);
    assert.equal(r.cost.toFixed(6), (400 * 30 / 1e6 + 20 * 5 / 1e6 + 100 * 0.2 / 1e6 + 50 * 1.25 / 1e6).toFixed(6));
    // The .md is not an image, so no list shows it.
    assert.equal(require('../../images').IMAGE_RE.test('sq.md'), false);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('when the description call fails the image is kept, marked "not written", and Describe it is offered', async () => {
  const s = await standIn((url) => (url.includes('chat') ? [500, { error: { message: 'busy' } }]
    : [200, { data: [{ b64_json: PNG.toString('base64') }], usage: { output_tokens: 10 } }]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  try {
    const r = await ai.generate({ prompt: 'x', count: '1', name: 'nodesc', confirm: 'yes' }, { key: 'sk-test-key', dir });
    assert.equal(r.ok, true);
    assert.deepEqual(r.undescribed, ['nodesc.png']);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'nodesc.png.json'), 'utf8')).description, 'not written');
    const page = read('images-page.js');
    assert.match(page, /hx-post="\/actions\/image-describe" hx-trigger="confirmed-remove"/);
    assert.match(page, /made\.description === 'not written' \? 'The description was not written\.'/);
    assert.equal((await ai.describeExisting({ file: 'x.png' })).status, 400);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Copy Markdown uses the alt text, and the plan prices the description', () => {
  assert.match(read('images-page.js'), /data-copy="\$\{esc\(`!\[\$\{String\(\(made && made\.alt\) \|\| im\.name/);
  const p = ai.plan({ prompt: 'x', quality: 'low', count: '2' });
  assert.equal(p.estimate.toFixed(3), ((0.006 + ai.DESCRIBE_ESTIMATE) * 2).toFixed(3));
  assert.match(ai.planHtml(p), /for the description/);
});

test('Edit with AI sends the source as multipart, never overwrites, records its source, and refuses an SVG', async () => {
  const s = await standIn((url) => (url.includes('chat') ? [200, DESCRIBED]
    : [200, { data: [{ b64_json: PNG.toString('base64') }], usage: { output_tokens: 300, input_tokens: 50, input_tokens_details: { image_tokens: 40, text_tokens: 10 } } }]));
  const imagesRoot = require('../../workspaces').workspaceDir('images');
  const dir = fs.mkdtempSync(path.join(imagesRoot, 'test-ai-edit-'));
  const relDir = path.basename(dir);
  try {
    fs.writeFileSync(path.join(dir, 'pic.png'), PNG);
    fs.writeFileSync(path.join(dir, 'pic-ai-v1.png'), PNG);
    assert.equal((await ai.editImage({ src: 'images', file: `${relDir}/pic.png`, prompt: 'warmer' }, { key: 'sk-test-key' })).status, 400);
    const r = await ai.editImage({ src: 'images', file: `${relDir}/pic.png`, prompt: 'make it warmer', quality: 'low', confirm: 'yes' }, { key: 'sk-test-key' });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.name, 'pic-ai-v2.png');
    const edit = s.seen.find((x) => x.url.includes('edits'));
    assert.match(edit.type, /^multipart\/form-data; boundary=/);
    const raw = edit.raw.toString('latin1');
    assert.match(raw, /name="prompt"\r\n\r\nmake it warmer\r\n/);
    assert.match(raw, /name="image"; filename="pic\.png"\r\nContent-Type: image\/png/);
    assert.equal(edit.auth, 'Bearer sk-test-key');
    const side = JSON.parse(fs.readFileSync(path.join(dir, 'pic-ai-v2.png.json'), 'utf8'));
    assert.deepEqual(side.source, { workspace: 'images', path: `${relDir}/pic.png` });
    assert.equal(side.edit_prompt, 'make it warmer');
    assert.equal(side.alt, 'Blue square');
    assert.ok(fs.readFileSync(path.join(dir, 'pic.png')).equals(PNG), 'the source is unchanged');
    fs.writeFileSync(path.join(dir, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
    assert.match(ai.editPlan({ src: 'images', file: `${relDir}/logo.svg`, prompt: 'x' }).error, /SVG cannot be edited/);
    assert.equal(ai.aiVersionName(dir, 'pic.png', 'png'), 'pic-ai-v3.png');
    assert.equal(ai.nearestSize(1600, 1000), '1536x1024');
    assert.match(ai.editPlanHtml(ai.editPlan({ src: 'images', file: `${relDir}/pic.png`, prompt: 'x' })), /hx-trigger="confirmed-remove"/);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an edit of an image from another workspace is saved into images/edited/', () => {
  const p = ai.editPlan({ src: 'docs', file: 'nothing-here.png', prompt: 'x' });
  assert.equal(p.ok, false);
  assert.match(read('images-ai.js'), /const dir = src === 'images' \? path\.dirname\(where\.abs\) : path\.join\(workspaceDir\('images'\), 'edited'\);/);
});
