#!/usr/bin/env node
/**
 * The command line over drive.js, run by cmd-tools-google-drive-sync.sh:
 *
 *   node lib/cli.js sync <workspace> [--folder <id|url>] [--item <name>] [--dry-run] [--overwrite]
 *   node lib/cli.js status
 *
 * Exit 0 ok, 1 something failed, 3 nothing written because it would overwrite files or write into sub
 * folders already on Drive and --overwrite (the approval) was not given.
 */

const ctx = require('./context');
const drive = require('./drive');

async function main() {
  ctx.migrate();   // the first run from anywhere moves the settings out of settings.yml
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] || '' : ''; };

  if (cmd === 'status') {
    const s = drive.driveSettings();
    console.log(`client id and secret : ${s.configured ? 'set' : 'MISSING (client_id / client_secret in plugin.google-drive-sync.settings.yml)'}`);
    console.log(`connected            : ${s.connected ? 'yes' : 'no (press Connect in the dashboard)'}`);
    console.log(`account (setting)    : ${s.account || '(not set)'}`);
    console.log(`storage folder       : ${s.rootFolder || '(none: each workspace needs its own destination)'}`);
    if (s.connected) {
      const u = await drive.about();
      console.log(`account              : ${u.displayName || ''} <${u.emailAddress || ''}>`);
    }
    console.log(`redirect uri         : ${s.redirectUri}`);
    for (const [ws, id] of Object.entries(s.destinations)) console.log(`destination ${ws.padEnd(10)}: ${id || '(not chosen)'}   targets: ${(s.targets[ws] || []).join(' ') || '(none: nothing is pushed)'}`);
    return 0;
  }

  if (cmd === 'sync') {
    const workspace = rest[0];
    if (!workspace || workspace.startsWith('--')) throw new Error('Usage: cli.js sync <workspace> [--folder id] [--item name] [--dry-run] [--overwrite]');
    const dryRun = rest.includes('--dry-run');
    const r = await drive.pushWorkspace(workspace, {
      folderId: flag('--folder'), item: flag('--item'), dryRun, approve: rest.includes('--overwrite'), log: (l) => console.log(l),
    });
    if (!r.written && !dryRun && r.needsApproval) return 3;
    console.log(`\n${dryRun ? 'Would do' : 'Done'}: ${drive.summary(r.stats)}.`);
    return r.stats.failed ? 1 : 0;
  }

  throw new Error('Usage: cli.js sync|status');
}

main().then((code) => process.exit(code), (err) => { console.error(`ERROR: ${err.message}`); process.exit(1); });
