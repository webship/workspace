/**
 * Workspace notes — the reference plugin, and a real feature.
 *
 * Adds a "Notes" button to the rail of every workspace it is enabled for
 * (settings.yml `plugins.workspace-notes.workspaces`), opening NOTES.md from
 * that workspace folder in the editor modal: why this folder is what it is,
 * which projects matter, what the next person should know. The file lives in
 * the folder itself, beside the work it describes.
 */

module.exports.register = (api) => {
  const fs = require('fs');
  const path = require('path');
  const { esc, workspaceDir, isValidWorkspace } = api.lib;

  const notesFile = (key) => path.join(workspaceDir(key), 'NOTES.md');

  api.addPageActions(({ view, key, meta }) => {
    if (view !== 'workspace' || !key || !api.appliesTo(key)) return null;
    const exists = fs.existsSync(notesFile(key));
    return {
      label: 'Notes',
      items: [
        `<button class="uk-button uk-button-default action-btn" hx-get="/fragments/p/${api.name}/edit?workspace=${esc(key)}"`
        + ` hx-target="#editor-modal-body" hx-swap="innerHTML" title="${esc(meta.label)}'s NOTES.md — kept in the folder itself">`
        + `<span uk-icon="icon: file-edit; ratio: .8"></span><span class="action-label">Notes${exists ? '' : ' (new)'}</span></button>`,
      ],
    };
  });

  api.addFragment(({ send, rest, searchParams }) => {
    if (rest !== 'edit') return send('<div class="msg error">Unknown notes fragment.</div>', 404);
    const key = String(searchParams.get('workspace') || '');
    if (!isValidWorkspace(key) || !api.appliesTo(key)) return send('<div class="msg error">Unknown workspace.</div>', 400);
    let content = '';
    try { content = fs.readFileSync(notesFile(key), 'utf-8'); } catch (_) { /* new file */ }
    send(`
      <div class="editor-card">
        <h3 class="uk-margin-small-bottom">Notes — ${esc(key)}/NOTES.md</h3>
        <p class="uk-text-meta">Lives in the workspace folder itself, beside the work it describes.</p>
        <form hx-post="/actions/p/${api.name}/save" hx-target="#webship-workspace-output" hx-swap="innerHTML"
              hx-on::after-request="window.UIkit && UIkit.modal('#editor-modal').hide()">
          <input type="hidden" name="workspace" value="${esc(key)}">
          <textarea class="uk-textarea" name="content" rows="16" placeholder="What the next person should know about this folder…">${esc(content)}</textarea>
          <div class="uk-margin-small-top">
            <button type="submit" class="uk-button uk-button-primary"><span uk-icon="icon: check; ratio: .8"></span> Save</button>
          </div>
        </form>
      </div>`);
  });

  api.addAction('save', ({ form, send, workspace }) => {
    if (!api.appliesTo(workspace)) return send('<div class="msg error">Notes are not enabled for this workspace.</div>', 400);
    const content = String(form.content || '').replace(/\r\n/g, '\n');
    if (content.length > 500000) return send('<div class="msg error">Content too large.</div>', 400);
    fs.writeFileSync(notesFile(workspace), content);
    return send(`<div class="msg assistant">✅ Saved <strong>${esc(workspace)}/NOTES.md</strong>.</div>`);
  });
};
