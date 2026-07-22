/*
 * workspace dashboard — basic Node.js (node:http, no framework) + HTMX.
 * All interactivity is server-rendered HTML fragments swapped in by HTMX;
 * the only client scripts are the vendored htmx.min.js and a tiny ui.js.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const querystring = require('querystring');
const {
  ROOT,
  loadWorkspaces,
  isValidWorkspace,
  workspaceDir,
  findBackupScript,
  findRemoveScript,
  findFilemodeScript,
  findBuilderScripts,
} = require('./workspaces');

const PUBLIC_DIR = path.join(__dirname, 'public');
const NAME_RE = /^[a-zA-Z0-9_-]+$/;
const SCRIPT_RE = /^cmd-[a-zA-Z0-9_.-]+\.sh$/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- process helpers ---------------- */

function run(cmd, args, cwd, { timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ ok: false, code: -1, stdout, stderr: String(err.message) }); });
  });
}

function listProjects(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => e.name);
  } catch (_) {
    return [];
  }
}

/* ---------------- shared page chrome ---------------- */

function pageShell(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/style.css">
<script src="/htmx.min.js"></script>
<script src="/ui.js" defer></script>
</head>
<body>
<div class="bg-glow"></div>
${body}
<footer class="footer">
  <span>webship/workspace · DDEV-only tooling · <a href="/">workspace.ddev.site</a></span>
</footer>
</body>
</html>`;
}

// The AI assistant panel — included on EVERY page. `floating` renders it as
// the bottom-right widget with a 🤖 launcher; inline renders it in the flow.
function assistantHtml({ floating }) {
  const panel = `
    <div class="assistant-panel">
      <div class="assistant-header">
        <span class="ah-title"><span class="bot">🤖</span> workspace AI Assistant</span>
        <span class="ddev-badge">DDEV Mode ✓</span>
      </div>
      <p class="assistant-tagline">Ask me anything about workspace, DDEV, or Drupal development tasks!</p>
      <div class="quick-actions">
        <form hx-post="/actions/quick-build" hx-target="#chat-log" hx-swap="beforeend" class="qa-form">
          <input type="hidden" name="script" value="cmd-drupal11-0-x-recommended-project.sh">
          <input type="hidden" name="flags" value="--install">
          <input type="text" name="projectName" placeholder="name…" class="qa-name" required pattern="[a-zA-Z0-9_-]+">
          <button type="submit">➕ New Drupal 11</button>
        </form>
        <form hx-post="/actions/quick-build" hx-target="#chat-log" hx-swap="beforeend" class="qa-form">
          <input type="hidden" name="script" value="cmd-varbase10-1-x-project.sh">
          <input type="hidden" name="flags" value="--install --add-users">
          <input type="text" name="projectName" placeholder="name…" class="qa-name" required pattern="[a-zA-Z0-9_-]+">
          <button type="submit">🚀 New Varbase</button>
        </form>
        <button hx-get="/actions/status" hx-target="#chat-log" hx-swap="beforeend">💚 Status</button>
      </div>
      <div class="chat-log" id="chat-log">
        <div class="msg assistant">
          <p><strong>Hi!</strong> I can help you:</p>
          <ul>
            <li>Show you all available commands in any workspace</li>
            <li>Give step-by-step instructions with code examples</li>
          </ul>
          <p>💡 <strong>Try these examples:</strong></p>
          <ul>
            <li>"Create a new Varbase project"</li>
            <li>"Show me all available commands"</li>
            <li>"What's the system status?"</li>
          </ul>
        </div>
      </div>
      <form class="chat-input"
            hx-post="/actions/chat" hx-target="#chat-log" hx-swap="beforeend"
            hx-on::after-request="this.reset()">
        <input type="text" name="message" placeholder="Ask me anything about workspace, DDEV, or Drupal..." autocomplete="off" required>
        <button type="submit">Send ➤</button>
      </form>
    </div>`;

  if (floating) {
    return `
      <div class="assistant-float assistant-card" id="assistant-float">${panel}</div>
      <button class="assistant-launcher" onclick="document.getElementById('assistant-float').classList.toggle('open')" title="workspace AI Assistant">🤖</button>`;
  }
  return `<div class="assistant-card">${panel}</div>`;
}

/* ---------------- pages ---------------- */

function homePage() {
  const workspaces = loadWorkspaces();
  const cards = Object.values(workspaces).map((w) => {
    const projectCount = listProjects(w.dir).length;
    const hasBuilders = findBuilderScripts(w.dir).length > 0;
    return `
      <a class="workspace-card" href="/${esc(w.key)}">
        <div class="icon">${w.icon}</div>
        <div class="label">${esc(w.label)}</div>
        <div class="subtitle">${esc(w.subtitle)}</div>
        <div class="count${hasBuilders ? ' buildable' : ''}">${projectCount} project${projectCount === 1 ? '' : 's'}${hasBuilders ? ' · buildable' : ''}</div>
      </a>`;
  }).join('');

  return pageShell('workspace', `
<header class="hero">
  <div class="logo"><span>🛠️</span></div>
  <h1>workspace</h1>
  <p class="subtitle">
    The <strong>workspace</strong> management system helps developers manage the base code
    development work cycle for custom distributions and starter kit templates —
    on your Linux development computer or servers with DDEV/Docker.
  </p>
  <nav class="pill-links">
    <a class="pill" href="https://github.com/webship/workspace" target="_blank"><span class="pi">📄</span> Complete README</a>
    <button class="pill" hx-get="/actions/status" hx-target="#chat-log" hx-swap="beforeend"><span class="pi">💚</span> Health Check</button>
  </nav>
</header>

<main class="layout">
  ${assistantHtml({ floating: false })}
  <section class="workspaces-card">
    <h2>Workspaces</h2>
    <p class="workspaces-sub">Browse and manage your development environments</p>
    <div class="workspace-grid">${cards}</div>
  </section>
</main>`);
}

function projectRowsHtml(key, dir) {
  const projects = listProjects(dir);
  const canBackup = !!findBackupScript(dir);
  const canRemove = !!findRemoveScript(dir);
  const canFilemode = !!findFilemodeScript(dir);

  const rows = projects.map((p) => `
    <div class="project-row">
      <span class="project-name">📁 ${esc(p)}</span>
      <span class="project-actions">
        ${canBackup ? `<button class="secondary" hx-post="/actions/backup" hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(p)}"}' hx-target="#webship-workspace-output" hx-swap="innerHTML">💾 Backup</button>` : ''}
        ${canFilemode ? `<button class="secondary" hx-post="/actions/filemode" hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(p)}"}' hx-target="#webship-workspace-output" hx-swap="innerHTML">🔧 Filemode</button>` : ''}
        ${canRemove ? `<button class="danger arm-step" data-armed="0" hx-post="/actions/remove" hx-vals='{"workspace":"${esc(key)}","projectName":"${esc(p)}","confirm":"yes"}' hx-target="#webship-workspace-output" hx-swap="innerHTML" hx-trigger="confirmed-remove">🗑️ Remove</button>` : ''}
      </span>
    </div>`).join('');

  return `
    <h3>Projects <span class="count-chip">${projects.length}</span></h3>
    ${rows || '<p class="webship-workspace-meta">No projects yet.</p>'}`;
}

function workspacePage(key) {
  const workspaces = loadWorkspaces();
  const meta = workspaces[key];
  const dir = meta.dir;
  const builders = findBuilderScripts(dir);
  const builderOptions = builders.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

  return pageShell(`${meta.label} · workspace`, `
<header class="hero hero-compact">
  <a class="back-link" href="/">← All workspaces</a>
  <div class="logo logo-sm"><span>${meta.icon}</span></div>
  <h1>${esc(meta.label)}</h1>
  <p class="subtitle">${esc(meta.subtitle)}</p>
</header>

<main class="webship-workspace-page">
  <section class="workspaces-card">
    ${builders.length ? `
      <h3>Build a new project</h3>
      <form class="build-row" hx-post="/actions/build" hx-target="#webship-workspace-output" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="${esc(key)}">
        <select name="script">${builderOptions}</select>
        <input name="projectName" placeholder="new-project-name" required pattern="[a-zA-Z0-9_-]+">
        <button type="submit" class="primary">Build</button>
      </form>
    ` : ''}

    <div id="webship-workspace-projects" hx-get="/fragments/${esc(key)}/projects" hx-trigger="refresh-projects from:body">
      ${projectRowsHtml(key, dir)}
    </div>

    <div id="webship-workspace-output"></div>
  </section>
</main>

${assistantHtml({ floating: true })}`);
}

/* ---------------- HTMX fragments/actions ---------------- */

function resultFragment(result, intro) {
  const text = (result.stdout || '') + (result.stderr ? `\n${result.stderr}` : '');
  return `
    <div class="msg ${result.ok ? 'assistant' : 'error'}">
      ${intro ? `<p>${intro}</p>` : ''}
      <pre>${esc(text.slice(-3000) || JSON.stringify(result))}</pre>
    </div>`;
}

async function handleAction(pathname, form, res) {
  const send = (html, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  };

  const workspace = form.workspace || 'dev';
  if (pathname !== '/actions/chat' && pathname !== '/actions/status' && !isValidWorkspace(workspace)) {
    return send('<div class="msg error">Unknown workspace.</div>', 400);
  }

  if (pathname === '/actions/build' || pathname === '/actions/quick-build') {
    const dir = workspaceDir(workspace);
    const script = String(form.script || '');
    const projectName = String(form.projectName || '');
    if (!SCRIPT_RE.test(script) || !findBuilderScripts(dir).includes(script)) return send('<div class="msg error">Unknown build script.</div>', 400);
    if (!NAME_RE.test(projectName)) return send('<div class="msg error">Invalid project name.</div>', 400);
    const flags = String(form.flags || '--install').split(' ').filter((f) => /^--[a-zA-Z0-9=_.,-]*$/.test(f));
    const result = await run('bash', [script, projectName, ...flags], dir);
    return send(resultFragment(result, `🏗️ Build <strong>${esc(projectName)}</strong> (${esc(script)}) ${result.ok ? 'finished' : 'failed'}.`));
  }

  if (pathname === '/actions/backup') {
    const dir = workspaceDir(workspace);
    const script = findBackupScript(dir);
    if (!script) return send('<div class="msg error">No backup script in this workspace.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const result = await run('bash', [script, form.projectName], dir);
    return send(resultFragment(result, `💾 Backup <strong>${esc(form.projectName)}</strong> ${result.ok ? 'finished' : 'failed'}.`));
  }

  if (pathname === '/actions/filemode') {
    const dir = workspaceDir(workspace);
    const script = findFilemodeScript(dir);
    if (!script) return send('<div class="msg error">No filemode script in this workspace.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const result = await run('bash', [script, form.projectName], dir);
    return send(resultFragment(result, `🔧 Filemode fix on <strong>${esc(form.projectName)}</strong> ${result.ok ? 'done' : 'failed'}.`));
  }

  if (pathname === '/actions/remove') {
    const dir = workspaceDir(workspace);
    const script = findRemoveScript(dir);
    if (!script) return send('<div class="msg error">No remove script in this workspace.</div>', 400);
    if (form.confirm !== 'yes') return send('<div class="msg error">Destructive action requires confirmation.</div>', 400);
    if (!NAME_RE.test(String(form.projectName || ''))) return send('<div class="msg error">Invalid project name.</div>', 400);
    const result = await run('bash', [script, form.projectName], dir);
    // HX-Trigger tells the page to refresh its project list.
    res.setHeader('HX-Trigger', 'refresh-projects');
    return send(resultFragment(result, `🗑️ Remove <strong>${esc(form.projectName)}</strong> ${result.ok ? 'finished' : 'failed'}.`));
  }

  if (pathname === '/actions/status') {
    const result = await run('ddev', ['list', '--json-output'], ROOT, { timeoutMs: 60 * 1000 });
    let lines = '';
    try {
      const parsed = JSON.parse(result.stdout);
      lines = (parsed.raw || [])
        .map((p) => `${p.status === 'running' ? '🟢' : '⚪'} ${p.name} — ${p.status}${p.status === 'running' ? ` — ${p.primary_url}` : ''}`)
        .join('\n') || 'No DDEV projects registered.';
    } catch (_) {
      lines = (result.stdout + '\n' + result.stderr).replace(/\x1b\[[0-9;]*m/g, '').trim();
    }
    return send(`
      <div class="msg ${result.ok ? 'assistant' : 'error'}">
        <p>💚 <strong>DDEV status:</strong></p>
        <pre>${esc(lines)}</pre>
      </div>`);
  }

  if (pathname === '/actions/chat') {
    const message = String(form.message || '').trim();
    if (!message) return send('<div class="msg error">Empty message.</div>', 400);
    const userHtml = `<div class="msg user">${esc(message)}</div>`;
    const args = [
      '-p', message,
      '--output-format', 'json',
      '--permission-mode', 'plan',
      '--disallowedTools', 'Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'Agent',
      '--no-session-persistence',
    ];
    const result = await run('claude', args, ROOT, { timeoutMs: 120 * 1000 });
    let reply = result.stdout.trim();
    try {
      const parsed = JSON.parse(result.stdout);
      reply = parsed.result || parsed.response || reply;
    } catch (_) { /* raw text fallback */ }
    if (!reply) reply = result.stderr.trim() || 'No response from the assistant.';
    return send(`${userHtml}<div class="msg assistant">${esc(reply)}</div>`);
  }

  send('<div class="msg error">Unknown action.</div>', 404);
}

/* ---------------- static files ---------------- */

const MIME = {
  '.css': 'text/css', '.js': 'application/javascript', '.html': 'text/html',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

function serveStatic(pathname, res) {
  const file = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^([.][.][/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
  return true;
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  try {
    if (req.method === 'GET') {
      if (pathname === '/' ) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(homePage());
      }
      if (pathname === '/actions/status') return handleAction(pathname, {}, res);
      const fragMatch = pathname.match(/^\/fragments\/([a-z0-9_-]+)\/projects$/);
      if (fragMatch && isValidWorkspace(fragMatch[1])) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(projectRowsHtml(fragMatch[1], workspaceDir(fragMatch[1])));
      }
      const wsKey = pathname.replace(/^\/+|\/+$/g, '');
      if (isValidWorkspace(wsKey)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(workspacePage(wsKey));
      }
      if (serveStatic(pathname, res)) return;
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }

    if (req.method === 'POST' && pathname.startsWith('/actions/')) {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => handleAction(pathname, querystring.parse(body), res));
      return;
    }

    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Method not allowed');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server error: ${err.message}`);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`workspace-dashboard (node:http + HTMX) listening on :${PORT}`);
});
