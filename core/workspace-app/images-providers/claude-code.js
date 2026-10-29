/**
 * Claude Code CLI as an image provider. Claude cannot render a raster picture, so it DRAWS: it writes one SVG,
 * and a fixed step afterwards sanitises it, renders a PNG with headless Chrome and writes the records.
 *
 * It runs on the host as a screen session under the person's own Claude Code login, so there is no API charge.
 * The prompt reaches claude from a 0600 file through $(cat …), never on the shell line.
 */

const fs = require('fs');
const path = require('path');

const { ROOT, workspaceDir } = require('../workspaces');

const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
const PIXELS = { square: [1024, 1024], landscape: [1536, 1024], portrait: [1024, 1536] };

/** Whether a claude CLI is on this machine's PATH (the dashboard and the host share the tree and the login). */
function hasClaude() {
  const dirs = String(process.env.PATH || '').split(':').concat([path.join(process.env.HOME || '', '.local', 'bin')]);
  return dirs.some((d) => d && fs.existsSync(path.join(d, 'claude')));
}

/** What claude is asked to do: one file, the words, and nothing else. */
function promptFor(job) {
  if (job.fullPrompt) return job.fullPrompt;
  const [w, h] = job.pixels;
  const style = job.styleNote ? `\n${job.styleNote}\n` : '';
  const source = job.sourceSvg ? `\nStart from this existing SVG and change it as asked; keep what is not asked to change:\n\n${job.sourceSvg}\n` : '';
  return `Draw an image as SVG code. You cannot make a photo, so make a clean, flat vector illustration.

The image: ${job.prompt}
${style}${source}
Write exactly two files in the current folder and nothing else:
1. ${job.name}.svg: one self-contained SVG with viewBox="0 0 ${w} ${h}" and no width or height attribute. No <script>, no <foreignObject>, no event handlers, no <image>, nothing outside the file: url() and href may point only at an id in this same file, so gradients and clip paths are fine. Use the palette: ${job.palette}.
2. ${job.name}.claude.json: {"summary": "one or two plain sentences on what the drawing shows", "alt": "alt text, at most 125 characters"}.

Do not run any commands. When both files are written, stop.`;
}

/**
 * Start the session. Returns { ok, session } or { ok: false, error }.
 * `start` is the runner call (jobs.hostRunnerRequest), passed in so tests need no runner.
 */
async function startSession(job, start) {
  const dir = job.dir || path.join(workspaceDir('images'), 'generated');
  fs.mkdirSync(dir, { recursive: true });
  const promptsDir = path.join(ROOT, '.screens', 'prompts');
  fs.mkdirSync(promptsDir, { recursive: true, mode: 0o700 });
  const session = `images--claude-${job.name}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60);
  const promptFile = path.join(promptsDir, `${session}.txt`);
  const jobFile = path.join(promptsDir, `${session}.job.json`);
  fs.writeFileSync(promptFile, promptFor(job), { mode: 0o600 });
  fs.writeFileSync(jobFile, JSON.stringify({ ...job, dir, sourceSvg: undefined, fullPrompt: undefined }), { mode: 0o600 });
  const finish = path.join(ROOT, 'core', 'workspace-app', 'scripts', 'images-claude-finish.js');
  // The prompt comes first: --allowedTools takes a list and would swallow anything after it.
  const draw = `claude -p "$(cat ${shq(promptFile)})" --output-format text --permission-mode acceptEdits`
    + ' --allowedTools Write Read --disallowedTools Bash WebFetch WebSearch';
  const after = `node ${shq(finish)} ${shq(jobFile)}`;
  // A drawing the checks refuse exits 3 with the reason added to the prompt file, and is drawn again.
  const tries = Math.max(1, Math.min(5, Number(job.attempts) || 1));
  const cmd = tries > 1
    ? `for try in $(seq 1 ${tries}); do ${draw}; ${after}; rc=$?; [ "$rc" -eq 3 ] || break; done; exit "$rc"`
    : `${draw} && ${after}`;
  try { fs.writeFileSync(path.join(ROOT, '.screens', `${session}.cwd`), `${dir}\n`); } catch (_) { /* best effort */ }
  const answer = await start('start', { session, dir, owner: dir, cmd });
  if (!answer) return { ok: false, error: 'The screen runner is not up, so Claude Code could not start.' };
  if (answer.already) return { ok: false, error: `A session called ${session} is already running.` };
  if (!answer.ok) return { ok: false, error: String(answer.error || 'the runner refused it').slice(0, 200) };
  return { ok: true, session, cmd };
}

module.exports = {
  id: 'claude_code_cli',
  label: 'Claude Code CLI (draws an SVG)',
  keyName: null,
  async: true,
  kinds: ['generate', 'edit', 'svg'],
  models: { 'claude-code': 'Your Claude Code default model' },
  defaultModel: 'claude-code',
  sizes: { square: '1024x1024', landscape: '1536x1024', portrait: '1024x1536' },
  qualities: null,
  maxCount: 1,
  svgModels: { 'claude-code': 'Your Claude Code default model' },
  defaultSvgModel: 'claude-code',
  PIXELS,
  key: () => 'claude-code',
  available() { return hasClaude() ? { ok: true } : { ok: false, why: 'install the claude CLI on this machine' }; },
  estimate() { return 0; },
  editEstimate() { return 0; },
  svgEstimate() { return 0; },
  promptFor,
  startSession,
};
