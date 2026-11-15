/**
 * Edit a video into a new version: the tabs of the Edit modal post here.
 *
 * The form is `video-edit.js`; the work is `videos/cmd-tools-video-edit.sh`, run on the host in a screen
 * session like every other long action. Only a new section spoken with ElevenLabs spends credits, and that
 * needs `confirm=yes`, which only the confirm dialog's button sends.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { startInScreen, screenStartedHtml } = require('../jobs');
const voice = require('../audio-voice');
const videoEdit = require('../video-edit');

async function video_edit({ form, send, workspace }) {
  if (workspace !== 'videos') return send('<div class="msg error">Videos are edited in the videos workspace.</div>', 400);
  const found = form.mode === 'sections' ? await voice.loadEngines() : { engines: [] };
  const p = videoEdit.plan(form, found.engines);
  if (p.error) return send(`<div class="msg error">${esc(p.error)}</div>`, 400);
  if (p.spends && form.confirm !== 'yes') return send(videoEdit.spendHtml(p));
  const stringsFile = Object.keys(p.strings).length ? videoEdit.writeStrings(p.strings) : null;
  const opts = { workspace, project: path.basename(p.out, '.mp4'), projectDir: workspaceDir('videos'), verb: 'edit',
    cmdLine: videoEdit.commandLine(p, stringsFile, true), label: `video edit ${p.out}` };
  const started = await startInScreen(opts);
  if (!started.ok) {
    if (stringsFile) fs.rmSync(path.dirname(stringsFile), { recursive: true, force: true });
    return send(screenStartedHtml(started, opts.label, opts.project), started.already ? 409 : 500);
  }
  return send(voice.progressHtml({ kind: 'video', file: p.out, session: started.session, t0: Date.now(), engine: '', edit: '1' }, null));
}

// Ask the AI to make the change: a Claude Code screen in the videos folder, briefed with the video, its script,
// the tools, the rules, the settings already chosen on the tab, and the person's own words.
async function video_edit_ai({ form, send, res }) {
  const brief = videoEdit.askBrief(form);
  if (brief.error) return send(`<div class="msg error">${esc(brief.error)}</div>`, 400);
  let out = null;
  await require('./screens')['/actions/screen-new']({
    form: { target: brief.target, kind: 'claude', session: brief.session, command: brief.prompt },
    send: (html, status = 200) => { out = { html, status }; },
    res,
  });
  if (!out || out.status >= 400) return send((out && out.html) || '<div class="msg error">The session did not start.</div>', (out && out.status) || 500);
  const sessionName = `${brief.target.startsWith('p:') ? brief.target.slice(2).replace(':', '--') : 'videos'}--${brief.session}`.toLowerCase();
  return send(`<div class="msg assistant">
      <p>The AI (Claude Code) is working on <strong>${esc(brief.file)}</strong> in the session <code>${esc(sessionName)}</code>.</p>
      <p class="uk-text-meta">Watch it, answer it and approve its steps on <a href="/screens">Screens</a>, or <code>screen -r ${esc(sessionName)}</code> in your own terminal.
        The new version appears in the list when it is done; the original is not touched.</p></div>`);
}

module.exports = { '/actions/video-edit': video_edit, '/actions/video-edit-ai': video_edit_ai };
