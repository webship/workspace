#!/usr/bin/env node
/**
 * Google Drive MCP server (stdio), for the Claude Code CLI.
 *
 * Registered by `cmd-tools-google-drive-sync.sh -a register`. It reads the same settings (plugin.google-drive-sync.settings.yml) as
 * the dashboard, so no secret is written into the MCP registration. Unlike the claude.ai Drive
 * connector it uploads from a local path, streamed, so videos and archives are not a problem.
 *
 * Hand-rolled JSON-RPC over newline-delimited stdio: four methods are all this needs, and a
 * dependency for them would be one more thing to keep in sync.
 */

const fs = require('fs');
const path = require('path');

const ctx = require('./context');
const drive = require('./drive');

const { ROOT } = ctx;
ctx.migrate();

const TOOLS = [
  { name: 'drive_status', description: 'Whether Google Drive is configured and connected, the account, and the Drive folder chosen for each workspace.', inputSchema: { type: 'object', properties: {} } },
  { name: 'drive_list_folders', description: "List the folders inside a Drive folder. parent is a folder id, 'root' for My Drive (default), or 'shared' (Shared with me) or 'drives' (shared drives) when locations in the plugin settings allows them.", inputSchema: { type: 'object', properties: { parent: { type: 'string' } } } },
  { name: 'drive_create_folder', description: 'Create a folder inside a Drive folder and return its id.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, parent: { type: 'string', description: 'Folder id or link. Default root.' } }, required: ['name'] } },
  { name: 'drive_upload_file', description: 'Upload one local file (streamed) into a Drive folder. If a file with that name is already there it is NOT replaced unless overwrite is true, which needs the user\'s approval. The path must be inside the workspace tree.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, folder_id: { type: 'string' }, name: { type: 'string' }, overwrite: { type: 'boolean' } }, required: ['path', 'folder_id'] } },
  { name: 'drive_sync_workspace', description: "Push a workspace to its Drive destination, but ONLY the files that match targets.<workspace> in the plugin settings (the test workspace pushes its reports); with no targets nothing is pushed. Passing item pushes that one named item whatever the targets. Nothing on Drive is deleted. If it would overwrite files or write into sub folders already on Drive it writes NOTHING and returns the list: show that to the user and only call again with approve_overwrite true once they agree. Use dry_run to look first.", inputSchema: { type: 'object', properties: { workspace: { type: 'string' }, folder_id: { type: 'string', description: 'Overrides the destination from settings.' }, item: { type: 'string', description: 'One name inside the workspace.' }, dry_run: { type: 'boolean' }, approve_overwrite: { type: 'boolean', description: 'Only after the user has seen the list and approved.' } }, required: ['workspace'] } },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

async function callTool(name, a = {}) {
  switch (name) {
    case 'drive_status': {
      const s = drive.driveSettings();
      const out = { configured: s.configured, connected: s.connected, storage_folder: s.rootFolder, destinations: s.destinations };
      if (s.connected) out.account = await drive.about();
      return text(JSON.stringify(out, null, 2));
    }
    case 'drive_list_folders':
      return text(JSON.stringify(await drive.listFolders(a.parent || 'root'), null, 2));
    case 'drive_create_folder': {
      const parent = drive.parseFolderId(a.parent || 'root');
      if (!parent) return text('parent is not a Drive folder id or link.', true);
      return text(JSON.stringify(await drive.createFolder(String(a.name), parent)));
    }
    case 'drive_upload_file': {
      const file = fs.realpathSync(path.resolve(String(a.path)));
      const root = fs.realpathSync(ROOT);
      if (file !== root && !file.startsWith(root + path.sep)) return text(`Refused: ${a.path} is outside ${root}.`, true);
      const folder = drive.parseFolderId(a.folder_id);
      if (!folder) return text('folder_id is not a Drive folder id or link.', true);
      const name = a.name || path.basename(file);
      const match = (await drive.listChildren(folder)).find((c) => c.mimeType !== drive.FOLDER && c.name === name);
      if (match && !a.overwrite) return text(`${name} is already in that Drive folder. Nothing was written. Ask the user, and call again with overwrite true only if they approve replacing it.`);
      const id = await drive.uploadFile(file, name, folder, { existingId: match ? match.id : '' });
      return text(JSON.stringify({ id, name, replaced: !!match }));
    }
    case 'drive_sync_workspace': {
      const lines = [];
      const r = await drive.pushWorkspace(String(a.workspace), { folderId: a.folder_id || '', item: a.item || '', dryRun: !!a.dry_run, approve: !!a.approve_overwrite, log: (l) => lines.push(l) });
      const head = lines.slice(-200).join('\n');
      if (!r.written && !a.dry_run && r.needsApproval) return text(`${head}\n\nNEEDS APPROVAL: nothing was written.`);
      return text(`${head}\n\n${a.dry_run ? 'Would do' : 'Done'}: ${drive.summary(r.stats)}.`, r.stats.failed > 0);
    }
    default:
      return text(`Unknown tool ${name}`, true);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return { jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'webship-workspace-google-drive', version: '1.0.0' } } };
  }
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    try {
      return { jsonrpc: '2.0', id, result: await callTool(params.name, params.arguments) };
    } catch (err) {
      return { jsonrpc: '2.0', id, result: text(err.message, true) };
    }
  }
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (id === undefined) return null;                         // a notification needs no answer
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    handle(msg).then((reply) => { if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`); });
  }
});
