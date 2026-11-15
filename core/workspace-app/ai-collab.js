/**
 * Several AI CLIs on one spec: one writes, a different one reviews, a third may give a second
 * opinion, each run is kept beside the spec, and a person decides.
 *
 * This is the runner of that flow: it runs the documented non-interactive form of the CLI a role
 * names (settings: `roles` and `clis.<id>.run` in ai.defaults.yml / ai.settings.yml), with stdin
 * closed and a time limit, and writes what came back to `<spec>/collaboration/`. It passes no key and
 * shares no sign-in between CLIs: each one uses the person's own.
 *
 * A role whose CLI is switched off, missing, signed out, or the same as the author's is written down
 * as SKIPPED, with why. It is never faked and never handed to another CLI silently.
 *
 * No run merges, releases or marks anything reviewed. "Reviewed by a human" and "Code review by
 * maintainers" are never ticked by an AI: the record ends with a decision line only a person fills.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const A = require('./ai-anycli');

const ROLES = ['author', 'reviewer', 'second_opinion'];
const ROLE_LABEL = { author: 'Author', reviewer: 'Reviewer', second_opinion: 'Second opinion' };
const SPEC_FILES = ['00-constitution.md', '01-story.md', '02-analysis.md', '03-canvas.md', 'spec.yml'];
const PART_LIMIT = 60 * 1024;
// A file a run must never send to a provider.
const SECRET_FILE_RE = /(^|\/)(\.env(\..*)?|settings\.yml|.*\.settings\.yml|.*\.pem|.*\.key|id_[a-z0-9]+|.*credentials.*|.*secret.*)$/i;
const DECISION = '## Decision (a person)';

const root = () => process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..');
const fail = (m) => { throw new A.AnyCliError(m); };

/** The CLI a role names in the settings; `default` is the default CLI. */
function roleCli(role, cfg = A.loadConfig()) {
  if (!ROLES.includes(role)) fail(`Unknown role '${role}'. One of: ${ROLES.join(', ')}.`);
  const id = String(cfg.roles[role] || (role === 'author' ? 'default' : ''));
  return id === 'default' ? cfg.default_cli : id;
}

/** Why a CLI cannot play a part now, or '' when it can. */
function notReady(cli) {
  if (!cli) return 'no such CLI in the settings';
  if (!cli.enabled) return `${cli.label} is switched off`;
  if (!cli.run || !cli.run.includes('{prompt}')) return `${cli.label} has no non-interactive form in the settings (clis.${cli.id}.run)`;
  if (!cli.installed) return `${cli.label} is not installed (${cli.command} is not on the PATH)`;
  if (cli.signIn === 'signed out') return `${cli.label} is signed out`;
  return '';
}

/** Each role, the CLI the settings give it, and whether it can run now. */
function rolesStatus(cfg = A.loadConfig()) {
  const author = roleCli('author', cfg);
  return ROLES.map((role) => {
    const id = roleCli(role, cfg);
    const cli = id ? A.cliById(id, cfg) : null;
    let why = id ? notReady(cli) : 'no CLI is named for this role (roles in core/config/ai.settings.yml)';
    if (!why && role !== 'author' && id === author) why = `it is the author's CLI (${id}): a review comes from a different one`;
    return { role, cli: id, label: cli ? cli.label : id, ready: !why, why };
  });
}

function specDir(spec) {
  const rel = String(spec || '').replace(/\/+$/, '');
  if (!rel || path.isAbsolute(rel) || rel.split('/').some((p) => p === '..' || p === '.' || p === '')) fail('Name the spec folder, from the workspace root: --spec specs/dev/site/001-topic.');
  const dir = path.join(root(), rel);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail(`There is no ${rel} in this workspace.`);
  return { rel, dir };
}

function readPart(file) {
  const text = fs.readFileSync(file, 'utf8');
  return text.length > PART_LIMIT ? `${text.slice(0, PART_LIMIT)}\n[cut at ${PART_LIMIT} characters]\n` : text;
}

/** The runs kept beside a spec, oldest first, from the head of each file. */
function runsOf(dir) {
  const col = path.join(dir, 'collaboration');
  if (!fs.existsSync(col)) return [];
  return fs.readdirSync(col).filter((f) => /^\d{8}T\d{6}Z-/.test(f) && f.endsWith('.md')).sort().map((f) => {
    const { front, body } = A.splitFrontmatter(fs.readFileSync(path.join(col, f), 'utf8'));
    return { file: f, ...front, body: body.replace(/^\n+/, '') };
  });
}

const PREAMBLE = {
  author: 'You are the AUTHOR on this change. Do the work the spec asks for, as far as the task below says, and end with short notes: what you did, what you did not, and how it can be checked.',
  reviewer: 'You are the REVIEWER of this change, and you are a different AI provider than its author. Review the author\'s notes and the evidence against the spec. Do not redo the work. Begin your answer with one line, exactly one of:\nVerdict: agree\nVerdict: changes asked\nVerdict: cannot judge\nthen give your reasons, each tied to a line of the spec or of the notes.',
  second_opinion: 'You give a SECOND OPINION on this change, after its author and its reviewer, and you are a different AI provider than its author. Say where you agree and where you differ. Begin your answer with one line, exactly one of:\nVerdict: agree\nVerdict: changes asked\nVerdict: cannot judge\nthen give your reasons.',
};
const OVERSIGHT = 'A person decides what happens to this change. Do not merge, release, tag, publish or mark anything as reviewed or approved, and do not tick "Reviewed by a human" or "Code review by maintainers" anywhere.';

/** What a role is sent: its part, the rule, the spec, what came before, the evidence, the task. */
function buildPrompt(role, { rel, dir }, task, evidence) {
  const parts = [PREAMBLE[role], OVERSIGHT, `The spec is in ${rel}/ of the workspace.`];
  for (const f of SPEC_FILES) {
    const file = path.join(dir, f);
    if (fs.existsSync(file)) parts.push(`--- ${f} ---\n${readPart(file)}`);
  }
  if (role !== 'author') {
    const before = runsOf(dir).filter((r) => r.status === 'answered');
    const author = before.filter((r) => r.role === 'author').pop();
    if (author) parts.push(`--- the author's notes (${author.label}) ---\n${author.body}`);
    const reviewer = role === 'second_opinion' ? before.filter((r) => r.role === 'reviewer').pop() : null;
    if (reviewer) parts.push(`--- the reviewer's answer (${reviewer.label}) ---\n${reviewer.body}`);
  }
  if (evidence) parts.push(`--- evidence: ${evidence.rel} ---\n${readPart(evidence.file)}`);
  parts.push(`--- the task ---\n${task}`);
  return parts.join('\n\n');
}

function evidenceFile(rel) {
  if (!rel) return null;
  const clean = String(rel);
  if (path.isAbsolute(clean) || clean.split('/').some((p) => p === '..')) fail('Name the evidence file from the workspace root.');
  if (SECRET_FILE_RE.test(clean)) fail(`${clean} looks like a file that holds secrets: it is not sent to a provider.`);
  const file = path.join(root(), clean);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`There is no ${clean} in this workspace.`);
  return { rel: clean, file };
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Write record.md again from the runs, keeping whatever a person wrote under the decision heading. */
function writeRecord(dir, rel) {
  const file = path.join(dir, 'collaboration', 'record.md');
  let decision = '\n\n_Not decided yet._\n';
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file, 'utf8');
    const i = old.indexOf(DECISION);
    if (i >= 0) decision = old.slice(i + DECISION.length);
  }
  const rows = runsOf(dir).map((r) => `| ${r.at} | ${ROLE_LABEL[r.role] || r.role} | ${oneLine(r.label)}${r.version ? ` ${oneLine(r.version)}` : ''} | ${oneLine(r.status)} | ${r.verdict || ''} | [${r.file}](${r.file}) |`);
  fs.writeFileSync(file, `# Collaboration record: ${rel}

Who did what on this spec, by which AI CLI, and what each said. Written by \`core/scripts/ai-items.sh run\`.
A role that could not run is listed as skipped, with why: it is never filled in by another CLI.

| When (UTC) | Role | AI CLI | How it ended | Verdict | Notes |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

No AI merges, releases or marks this reviewed. "Reviewed by a human" and "Code review by maintainers"
are ticked by a person only. Two providers agreeing is evidence, not approval.

${DECISION}${decision}`);
  return file;
}

/**
 * Run one role on a spec. Returns { status, file, verdict, why }.
 *   role      author | reviewer | second_opinion
 *   spec      the spec folder, from the workspace root
 *   task      what to do, in words
 *   cliId     another CLI than the role's, for this run
 *   agent     an agent the CLI has installed, when its non-interactive form can name one
 *   evidence  a file from the workspace root (a test report), sent with the task
 */
function runRole({ role, spec, task, cliId = '', agent = '', evidence = '', timeoutMs = 20 * 60 * 1000, say = () => {} }) {
  if (!ROLES.includes(role)) fail(`Unknown role '${role}'. One of: ${ROLES.join(', ')}.`);
  if (!oneLine(task)) fail('Say what the role is to do, in words.');
  if (agent && !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(agent)) fail(`Not an agent name: '${agent}'.`);
  const where = specDir(spec);
  const proof = evidenceFile(evidence);
  const cfg = A.loadConfig();
  const id = cliId || roleCli(role, cfg);
  const cli = id ? A.cliById(id, cfg) : null;
  const authorRun = runsOf(where.dir).filter((r) => r.role === 'author' && r.status === 'answered').pop();
  const authorCli = authorRun ? authorRun.cli : roleCli('author', cfg);

  let why = id ? notReady(cli) : `no CLI is named for the ${role} role (roles.${role} in core/config/ai.settings.yml)`;
  if (!why && role !== 'author' && id === authorCli) why = `${cli.label} is the author's CLI: a review comes from a different one`;

  const at = stamp();
  const head = { role, cli: id || '', label: cli ? cli.label : (id || 'none'), at, task: oneLine(task) };
  if (agent) head.agent = agent;
  if (proof) head.evidence = proof.rel;
  let body; let verdict = '';

  if (why) {
    head.status = `skipped: ${why}`;
    body = `Skipped: ${why}.\n\nNothing was sent and nothing was answered. Run it again when that is no longer so.\n`;
    say(`${ROLE_LABEL[role]}: skipped: ${why}.`);
  } else {
    const version = spawnSync(cli.command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 });
    head.version = oneLine(String(version.stdout || '').split('\n')[0]).slice(0, 60);
    const prompt = buildPrompt(role, where, task, proof);
    const args = cli.run.map((a) => a.replace('{prompt}', prompt));
    if (agent && cli.agentArg) args.push(...cli.agentArg.map((a) => a.replace('{agent}', agent)));
    else if (agent) { head.agent = `${agent} (not named: ${cli.label} has no agent flag in the settings)`; }
    // The project the spec is about, when it is here; the workspace root otherwise.
    let cwd = root();
    try {
      const target = String((yaml.load(fs.readFileSync(path.join(where.dir, 'spec.yml'), 'utf8')) || {}).target || '');
      if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target) && fs.existsSync(path.join(root(), target))) cwd = path.join(root(), target);
    } catch (_) { /* no spec.yml: the root */ }
    say(`${ROLE_LABEL[role]}: ${cli.label}${head.version ? ` ${head.version}` : ''}, in ${path.relative(root(), cwd) || '.'} …`);
    // stdin closed: a CLI that waits on an open pipe never returns.
    const r = spawnSync(cli.command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
    const out = String(r.stdout || '').trim();
    if (r.error && r.error.code === 'ETIMEDOUT') head.status = `timed out after ${Math.round(timeoutMs / 60000)} min`;
    else if (r.error) head.status = `failed: ${oneLine(r.error.message).slice(0, 200)}`;
    else if (r.status !== 0) head.status = `failed (exit ${r.status})`;
    else if (!out) head.status = 'failed: it answered nothing';
    else head.status = 'answered';
    if (head.status === 'answered' && role !== 'author') {
      const m = out.match(/^\s*\**Verdict:\**\s*(agree|changes asked|cannot judge)\b/im);
      verdict = m ? m[1].toLowerCase() : 'not stated';
    }
    body = head.status === 'answered' ? `${out}\n`
      : `${out ? `${out}\n\n` : ''}It did not answer: ${head.status}.\n${oneLine(r.stderr) ? `\nWhat it said on the way out:\n\n    ${String(r.stderr).trim().split('\n').slice(-12).join('\n    ')}\n` : ''}`;
    say(`${ROLE_LABEL[role]}: ${head.status}${verdict ? `, verdict: ${verdict}` : ''}.`);
  }
  if (verdict) head.verdict = verdict;

  const col = path.join(where.dir, 'collaboration');
  fs.mkdirSync(col, { recursive: true });
  const name = `${at}-${role.replace('_', '-')}-${(id || 'none').replace(/[^a-z0-9_-]/gi, '')}.md`;
  fs.writeFileSync(path.join(col, name), `---\n${yaml.dump(head, { lineWidth: -1 })}---\n\n${body}`);
  const record = writeRecord(where.dir, where.rel);
  say(`Kept: ${path.relative(root(), path.join(col, name))}`);
  say(`Record: ${path.relative(root(), record)} (a person decides; nothing was merged, released or marked reviewed)`);
  return { status: head.status, file: path.join(col, name), verdict, why };
}

module.exports = { ROLES, roleCli, rolesStatus, notReady, buildPrompt, runRole, runsOf, writeRecord, SECRET_FILE_RE };
