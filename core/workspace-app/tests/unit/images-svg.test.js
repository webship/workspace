const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { sanitizeSvg, removedSummary } = require('../../images-svg-sanitize');
const core = require('../../images-svg-core');
const svg = require('../../images-svg');

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 400">'
  + '<g class="part"><path d="M10 10 L100 10" fill="none" stroke="#0074e0" stroke-width="4"/></g>'
  + '<g class="part"><circle cx="200" cy="200" r="40" fill="none" stroke="#2b447c" stroke-width="4"/></g>'
  + '<g class="part"><line x1="300" y1="100" x2="400" y2="300" stroke="#000000" stroke-width="4"/></g>'
  + '<g class="part" transform="translate(20 0)"><rect x="500" y="100" width="80" height="80" fill="none" stroke="#0074e0" stroke-width="4"/></g></svg>';

test('the sanitiser strips scripts, handlers and every way out of the file, and keeps safe drawing', () => {
  const r = sanitizeSvg(`<?xml version="1.0"?><svg viewBox="0 0 10 10" onload="x()"><script>alert(1)</script>
    <style>@import url(https://e.example/x.css); .a{fill:url(#g)} .b{background:url(https://e.example/t.png)}</style>
    <defs><linearGradient id="g"><stop offset="0" stop-color="#0074e0"/></linearGradient></defs>
    <foreignObject><div>hi</div><rect/></foreignObject>
    <a href="https://e.example"><path d="M0 0" onclick="x()" fill="url(#g)"/></a>
    <use href="https://e.example/s.svg#a"/><use href="#g"/><image href="https://e.example/p.png"/>
    <set attributeName="href" to="javascript:alert(1)"/><animate attributeName="opacity" from="0" to="1" dur="1s"/>
    <circle cx="1" cy="1" r="1" style="fill:url(https://e.example/x)"/><text>A &amp; B</text></svg>`);
  assert.doesNotMatch(r.svg, /script|onload|onclick|foreignObject|<image|e\.example|javascript:|@import|<a |<set/i);
  assert.match(r.svg, /<linearGradient id="g">/);
  assert.match(r.svg, /<path d="M0 0" fill="url\(#g\)"\/>/, 'a local url() survives; the handler does not');
  assert.match(r.svg, /<use href="#g"\/>/);
  assert.match(r.svg, /<animate attributeName="opacity"/);
  assert.match(r.svg, /<text>A &amp; B<\/text>/);
  assert.match(r.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 10 10">/);
  assert.equal(r.drawableLost, 1, 'the rect inside foreignObject was lost');
  assert.deepEqual(r.removed.elements, { script: 1, foreignObject: 1, a: 1, image: 1, set: 1 });
  assert.match(removedSummary(r), /1 script/);
  assert.equal(sanitizeSvg('no drawing here').svg, '');
});

test('the substance check wants a viewBox, four shapes and four parts', () => {
  assert.deepEqual(core.substance(GOOD), { ok: true, why: '', drawable: 4, parts: 4 });
  const thin = core.substance('<svg viewBox="0 0 1 1" width="10"><g class="part"><rect/></g></svg>');
  assert.equal(thin.ok, false);
  assert.match(thin.why, /width or height/);
  assert.match(thin.why, /1 drawable element, and it needs at least 4/);
  assert.match(thin.why, /1 <g class="part"> group, and it needs at least 4/);
  assert.match(core.substance('<svg><rect/></svg>').why, /no viewBox/);
  assert.equal(core.fixRoot('<svg width="960" height="400px"><g/></svg>'), '<svg viewBox="0 0 960 400"><g/></svg>');
});

test('a transform on an element a CSS animation moves goes onto a wrapping <g>', () => {
  const r = core.repairTransforms('<svg viewBox="0 0 1 1"><style>@media (prefers-reduced-motion: no-preference){.spin{animation:s 1s}}</style>'
    + '<g class="spin" transform="rotate(5)"><rect/></g><rect class="spin" transform="scale(2)"/><rect class="still" transform="scale(3)"/></svg>');
  assert.equal(r.moved, 2);
  assert.match(r.svg, /<g transform="rotate\(5\)"><g class="spin"><rect\/><\/g><\/g>/);
  assert.match(r.svg, /<g transform="scale\(2\)"><rect class="spin"\/><\/g>/);
  assert.match(r.svg, /<rect class="still" transform="scale\(3\)"\/>/, 'an element nothing animates keeps its transform');
});

test('Draw the strokes: parts are numbered for the stagger, strokes traced by length, reduced motion respected', () => {
  const done = core.finish(GOOD, { style: 'draw', motion: { duration: 1100, stagger: 110 } });
  assert.equal(done.ok, true, done.why);
  assert.equal(done.moved, 1, 'the part placed with a transform was wrapped');
  assert.match(done.svg, /@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(done.svg, /animation:part-rise 1100ms/);
  assert.match(done.svg, /calc\(var\(--i,0\)\*110ms\)/);
  assert.deepEqual([...done.svg.matchAll(/style="--i:(\d)"/g)].map((m) => m[1]), ['0', '1', '2', '3']);
  assert.equal((done.svg.match(/pathLength="1"/g) || []).length, 4);
  assert.doesNotMatch(core.finish(GOOD, { style: 'still' }).svg, /part-rise/);
});

test('the prompt is built from the svg: settings, with the brand palette and the style rules', () => {
  const cfg = svg.config();
  assert.match(cfg.brief, /flat line illustrations/);
  assert.deepEqual(cfg.palette, { primary: '#0074e0', secondary: '#2b447c', accent: '#e4dcff', dark: '#000000', light: '#ebe8e5' });
  assert.deepEqual([cfg.max_attempts, cfg.request_timeout, cfg.time_budget], [3, 180, 240]);
  assert.deepEqual([cfg.motion.duration, cfg.motion.stagger, cfg.motion.threshold, cfg.motion.replay], [1100, 110, 0.25, true]);
  const { system, user } = core.buildPrompt({ prompt: 'a lighthouse', style: 'draw', palette: cfg.palette, brief: cfg.brief, shape: 'wide' });
  assert.match(system, /The brief: Clean, flat line illustrations/);
  assert.match(system, /viewBox="0 0 960 400"> root, with no width or height/);
  assert.match(system, /primary #0074e0, secondary #2b447c, accent #e4dcff, dark #000000, light #ebe8e5/);
  assert.match(system, /Stroke only: every shape has fill="none"/);
  assert.match(system, /Answer with JSON only/);
  assert.equal(user, 'Draw: a lighthouse');
  assert.match(core.buildPrompt({ prompt: 'x', style: 'css', palette: cfg.palette, shape: 'square' }).system, /prefers-reduced-motion: no-preference/);
  const p = svg.plan({ prompt: 'x', palette_primary: '#ff0000', palette_dark: 'red; x' });
  assert.equal(p.palette.primary, '#ff0000', 'the form may change a colour for one run');
  assert.equal(p.palette.dark, '#000000', 'a value that is not a colour is ignored');
});

test('the examples are data in settings, generic, and free of the names they were adapted from', () => {
  const ex = svg.config().examples;
  assert.ok(ex.length >= 6 && ex.length <= 10, `${ex.length} examples`);
  const deny = /enlyte|mitchell|genex|coventry|partstrader|claim|insur|casualty|pharmac|nurse|injur|adjuster|workers.? comp|bill review|carrier|policyholder/i;
  const raw = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'workspace.images.settings.yml'), 'utf8');
  assert.doesNotMatch(raw, deny);
  for (const e of ex) {
    assert.ok(core.STYLES[e.style], e.title);
    assert.ok(e.prompt.length > 40, e.title);
    assert.doesNotMatch(`${e.title} ${e.prompt}`, deny);
  }
  const form = svg.formHtml();
  assert.match(form, /<select class="uk-select uk-form-small" id="svg-example" data-svg-example>/);
  assert.match(form, /data-prompt="Five rounded bars rising/);
});

// A stand-in for a chat model that answers from a list, recording each request.
async function standIn(replies) {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      const text = replies[Math.min(seen.length - 1, replies.length - 1)];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 1000, completion_tokens: 1000 } }));
    });
  });
  await new Promise((r) => srv.listen(0, r));
  process.env.OPENAI_CHAT_API = `http://127.0.0.1:${srv.address().port}/v1/chat/completions`;
  const https = require('https');
  const real = https.request;
  https.request = http.request;
  return { seen, close: () => { https.request = real; srv.close(); delete process.env.OPENAI_CHAT_API; } };
}

test('a thin answer is retried with the reason, and the second is saved with its records', async () => {
  const thin = JSON.stringify({ svg: '<svg viewBox="0 0 960 400"><g class="part"><rect/></g></svg>', summary: 's', alt: 'a' });
  const good = JSON.stringify({ svg: GOOD, summary: 'Four shapes in a row.', alt: 'Four outlined shapes' });
  const s = await standIn([thin, good]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-'));
  try {
    assert.equal((await svg.generateSvg({ prompt: 'shapes' })).status, 400, 'nothing without confirm');
    const r = await svg.generateSvg({ prompt: 'shapes', provider: 'openai', style: 'draw', name: 'shapes', confirm: 'yes' }, { key: 'sk-test', dir });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.attempts, 2);
    assert.equal(r.cost.toFixed(6), (2 * (1000 * 0.75 / 1e6 + 1000 * 4.5 / 1e6)).toFixed(6));
    const second = s.seen[1].messages;
    assert.equal(second[2].role, 'assistant');
    assert.match(second[3].content, /The drawing was not used: it has 1 drawable element/);
    const side = JSON.parse(fs.readFileSync(path.join(dir, 'shapes.svg.json'), 'utf8'));
    assert.deepEqual([side.style, side.attempts, side.provider, side.summary, side.alt],
      ['Draw the strokes', 2, 'OpenAI', 'Four shapes in a row.', 'Four outlined shapes']);
    assert.match(side.palette, /primary #0074e0/);
    assert.match(fs.readFileSync(path.join(dir, 'shapes.md'), 'utf8'), /- \*\*Style:\*\* Draw the strokes/);
    assert.match(fs.readFileSync(path.join(dir, 'shapes.svg'), 'utf8'), /part-rise/);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a drawing that lost shapes to the sanitiser is drawn again; one that never passes is reported, not saved', async () => {
  const lost = JSON.stringify({ svg: GOOD.replace('</svg>', '<foreignObject><rect/></foreignObject></svg>') });
  const s = await standIn([lost]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svg-'));
  try {
    const r = await svg.generateSvg({ prompt: 'x', provider: 'openai', style: 'still', confirm: 'yes' }, { key: 'sk-test', dir });
    assert.equal(r.ok, false);
    assert.equal(s.seen.length, 3, 'max_attempts');
    assert.match(s.seen[1].messages[3].content, /1 drawable element was lost/);
    assert.match(r.error, /No usable drawing after 3 attempts/);
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Gemini and Anthropic need a real key; Claude Code draws in a session, retried by its finish step', async () => {
  const noKey = await svg.generateSvg({ prompt: 'x', provider: 'anthropic', confirm: 'yes' });
  assert.equal(noKey.status, 503);
  assert.match(noKey.error, /ai_providers\.anthropic\.api_key/);
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svgcc-'));
  try {
    const r = await svg.generateSvg({ prompt: 'nodes; $(id)', provider: 'claude_code_cli', style: 'draw', name: 'nodes', confirm: 'yes' },
      { dir, start: async (a, payload) => { calls.push(payload); return { ok: true }; } });
    assert.equal(r.ok, true, r.error);
    const { cmd } = calls[0];
    assert.doesNotMatch(cmd, /nodes;|\$\(id\)/);
    assert.match(cmd, /^for try in \$\(seq 1 3\); do claude -p "\$\(cat '[^']+'\)" /);
    const promptFile = cmd.match(/cat '([^']+)'/)[1];
    const jobFile = cmd.match(/'([^']+\.job\.json)'/)[1];
    assert.match(fs.readFileSync(promptFile, 'utf8'), /Write exactly two files[\s\S]*1\. nodes\.svg/);
    const finish = require('../../scripts/images-claude-finish');
    fs.writeFileSync(path.join(dir, 'nodes.svg'), '<svg viewBox="0 0 960 400"><g class="part"><rect/></g></svg>');
    assert.equal(finish.main(jobFile), 3, 'refused, drawn again');
    assert.match(fs.readFileSync(promptFile, 'utf8'), /Your last drawing was refused\. The drawing was not used/);
    fs.writeFileSync(path.join(dir, 'nodes.svg'), GOOD);
    fs.writeFileSync(path.join(dir, 'nodes.claude.json'), JSON.stringify({ summary: 'Nodes.', alt: 'Nodes' }));
    assert.equal(finish.main(jobFile), 0);
    const side = JSON.parse(fs.readFileSync(path.join(dir, 'nodes.svg.json'), 'utf8'));
    assert.deepEqual([side.provider, side.attempts, side.style, side.alt], ['claude_code_cli', 2, 'Draw the strokes', 'Nodes']);
    assert.ok(!fs.existsSync(promptFile) && !fs.existsSync(jobFile));
    fs.rmSync(path.join(path.dirname(path.dirname(promptFile)), 'images--claude-nodes.cwd'), { force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the plan comes first, through the confirm dialog, and the viewer can replay and copy the markup', () => {
  const p = svg.plan({ prompt: 'nodes', provider: 'openai', style: 'draw' });
  const html = svg.planHtml(p);
  assert.match(html, /hx-trigger="confirmed-remove"/);
  assert.match(html, /&quot;confirm&quot;:&quot;yes&quot;/);
  assert.match(html, /at most 3 attempts/);
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'images-page.js'), 'utf8');
  assert.match(page, /data-svg-replay/);
  assert.match(page, /Copy SVG markup/);
  assert.match(page, /<source media="\(prefers-reduced-motion: reduce\)"/);
});
