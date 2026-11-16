#!/usr/bin/env node
/**
 * The terminal side of ai-anycli.js: sources of AI items and cmd-* commands, and the AI CLIs.
 *
 *   node ai-anycli-cli.js <kind> <verb> [name] [options]
 *
 *   kind   ai-agents | ai-skills | ai-commands | ai-prompts | cmd
 *   verb   sources                       each source, its state, its items and theirs
 *          source-add <source>           --as <id> --ref <branch> --path <folder> --item <name> --to <folder (cmd)>
 *          source-check [<id>]           ask upstream; changes no item
 *          source-update [<id>]          --force replaces an item changed here
 *          source-remove <id>            --keep-items, --force
 *          clis                          every AI CLI of the settings and its states
 *          items                         the folder's items against the CLIs that are on   (--to <folder>/<project>)
 *          install [<name>]              --cli <id|all> (default: the default CLI) --to <folder>/<project>
 *          uninstall <name>              --cli <id|all> --to <folder>/<project>
 *                                        --force also removes a file no install put there
 *
 *   node ai-anycli-cli.js roles                                   each role of a spec's flow, its CLI, ready or why not
 *   node ai-anycli-cli.js run --role <author|reviewer|second_opinion> --spec <folder> "<task>"
 *                                 --cli <id> (another CLI for this run) --agent <name> --evidence <file>
 *                                 runs that CLI's non-interactive form and keeps the answer beside the spec
 *
 * Reached through `bash core/scripts/ai-items.sh …` and through the flags of an ai-* folder's
 * `cmd-tools-ai-items.sh`. Nothing fetched is ever run.
 */

const A = require('./ai-anycli');

const say = (s) => process.stdout.write(`${s}\n`);
// `… | head` closes the pipe early: that is not an error worth a stack trace.
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); throw e; });

function parseArgs(argv) {
  const pos = []; const opt = {};
  const VALUE = new Set(['as', 'ref', 'path', 'item', 'to', 'cli', 'role', 'spec', 'agent', 'evidence', 'minutes']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const key = a.slice(2);
    if (VALUE.has(key)) { opt[key] = argv[i + 1] === undefined ? '' : argv[i + 1]; i += 1; } else opt[key] = true;
  }
  return { pos, opt };
}

const age = (iso) => {
  if (!iso) return '';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

function printSources(kind) {
  const list = A.sourcesStatus(kind);
  if (!list.length) { say(`No source for ${kind} yet. Add one: --source-add <owner/repo | https://… | skills.sh/owner/repo/skill>`); return; }
  for (const s of list) {
    say(`${s.id}  ${s.state}${s.checkedAt ? ` (checked ${age(s.checkedAt)})` : ''}`);
    say(`    ${s.url}${s.ref ? ` @${s.ref}` : ''}${s.path ? ` in ${s.path}` : ''}${s.via ? ` (from ${s.via})` : ''}${s.to ? ` -> ${s.to}/` : ''}`);
    if (!s.items.length) say('    (no item placed)');
    for (const it of s.items) say(`    ${it.name.padEnd(40)} ${it.state.padEnd(24)} ${it.to}`);
  }
}

function printClis() {
  const cfg = A.loadConfig();
  for (const c of A.listClis(cfg)) {
    const kinds = A.AI_KINDS.filter((k) => c.kinds[k] && c.kinds[k].convert).map((k) => k.replace(/^ai-/, '')).join(', ');
    say(`${c.id.padEnd(10)} ${c.label.padEnd(20)} ${A.cliStateWords(c).join(', ')}`);
    say(`${''.padEnd(10)} reads: ${kinds || 'nothing listed'}${c.docs ? `   ${c.docs}` : ''}`);
  }
  say(`default: ${cfg.default_cli}   settings: core/config/ai.settings.yml over core/config/ai.defaults.yml`);
}

function printItems(kind, to) {
  const { clis, rows } = A.matrix(kind, { to });
  if (!rows.length) { say(`No ${A.KIND_NOUN[kind]} in ${kind}/ yet.`); return; }
  say(`${'item'.padEnd(40)} ${clis.map((c) => c.id.padEnd(20)).join(' ')} source`);
  for (const r of rows) say(`${r.name.padEnd(40)} ${r.cells.map((c) => c.state.padEnd(20)).join(' ')} ${r.source || '-'}${r.sourceState ? ` (${r.sourceState})` : ''}`);
}

function main(argv) {
  const { pos, opt } = parseArgs(argv);
  const [kind, verb, name] = pos;
  if (pos[0] === 'roles' && !opt.help) {
    const C = require('./ai-collab');
    for (const r of C.rolesStatus()) say(`${r.role.padEnd(16)} ${String(r.label || '-').padEnd(20)} ${r.ready ? 'ready' : `skipped: ${r.why}`}`);
    say('settings: roles in core/config/ai.settings.yml over core/config/ai.defaults.yml');
    return 0;
  }
  if (pos[0] === 'run' && !opt.help) {
    const C = require('./ai-collab');
    const minutes = Number(opt.minutes) > 0 ? Number(opt.minutes) : 20;
    const r = C.runRole({ role: String(opt.role || ''), spec: String(opt.spec || ''), task: pos.slice(1).join(' '), cliId: typeof opt.cli === 'string' ? opt.cli : '',
      agent: typeof opt.agent === 'string' ? opt.agent : '', evidence: typeof opt.evidence === 'string' ? opt.evidence : '', timeoutMs: minutes * 60000, say });
    return r.status === 'answered' ? 0 : r.why ? 3 : 1;
  }
  if (!kind || !verb || opt.help) {
    say(require('fs').readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith(' *')).map((l) => l.replace(/^ \*\/?( |$)/, '')).join('\n'));
    return kind && verb ? 0 : 2;
  }
  if (!A.KINDS.includes(kind)) throw new A.AnyCliError(`Unknown kind '${kind}'. One of: ${A.KINDS.join(', ')}.`);
  const to = typeof opt.to === 'string' ? opt.to : '';
  switch (verb) {
    case 'sources': printSources(kind); return 0;
    case 'source-add':
      if (!name) throw new A.AnyCliError('Name the source: owner/repo, an https:// address, or skills.sh/owner/repo/skill.');
      A.sourceAdd(kind, name, { id: opt.as || '', ref: opt.ref || '', subpath: opt.path || '', item: opt.item || '', to, say });
      return 0;
    case 'source-check': A.sourceCheck(kind, name, { say }); printSources(kind); return 0;
    case 'source-update': A.sourceUpdate(kind, name, { say, force: !!opt.force }); return 0;
    case 'source-remove':
      if (!name) throw new A.AnyCliError('Name the source to remove (see --sources).');
      A.sourceRemove(kind, name, { say, keepItems: !!opt['keep-items'], force: !!opt.force });
      return 0;
    case 'clis': printClis(); return 0;
    case 'items': printItems(kind, to); return 0;
    case 'install': A.install(kind, name, opt.cli || 'default', { to, say }); return 0;
    case 'uninstall': A.uninstall(kind, name, opt.cli || 'default', { to, say, force: !!opt.force }); return 0;
    default: throw new A.AnyCliError(`Unknown verb '${verb}'. Run with --help.`);
  }
}

if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); } catch (e) {
    if (!(e instanceof A.AnyCliError)) throw e;
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArgs, age };
