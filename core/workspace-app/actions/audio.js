/**
 * The audio actions: generate a voice from text with Piper or ElevenLabs.
 *
 * The form is `audio-voice.js`; the work is `audio/cmd-tools-voice.sh`, run on the host in a screen
 * session like every other long action. Anything that spends credits needs `confirm=yes`, which only
 * the confirm dialog's button sends, and the command refuses to spend without its own `--confirm`.
 */

const fs = require('fs');
const path = require('path');

const { esc } = require('../html');
const { workspaceDir } = require('../workspaces');
const { startInScreen, screenStartedHtml } = require('../jobs');
const voice = require('../audio-voice');

async function generate_voice({ form, res, send, workspace }) {
  if (workspace !== 'audio') return send('<div class="msg error">Voices are generated in the audio workspace.</div>', 400);
  const found = await voice.loadEngines();
  const p = voice.plan(form, found.engines);
  if (p.error) return send(`<div class="msg error">${esc(p.error)}</div>`, 400);
  if (p.engine === 'elevenlabs' && form.confirm !== 'yes') {
    return send('<div class="msg error">ElevenLabs spends credits, so it needs your confirmation.</div>', 400);
  }
  // A script chosen from docs/ is read where it is; pasted text goes through a private temporary file.
  const textFile = p.scriptPath ? null : voice.writeText(p.kind === 'video' ? p.script : p.text);
  const opts = { workspace, project: path.basename(p.file, `.${p.ext}`), projectDir: workspaceDir('audio'),
    verb: 'voice', cmdLine: voice.commandLine(p, textFile, true), label: `${p.engine} ${p.kind === 'video' ? 'voiceover' : 'voice'} ${p.file}` };
  const started = await startInScreen(opts);
  // The command removes the text itself once it has run; when nothing started, nothing will.
  if (!started.ok) {
    if (textFile) fs.rmSync(path.dirname(textFile), { recursive: true, force: true });
    return send(screenStartedHtml(started, opts.label, opts.project), started.already ? 409 : 500);
  }
  // The modal stays open and says it is working; it asks again until the file is there.
  return send(voice.progressHtml({ kind: p.kind, file: p.file, session: started.session, t0: Date.now(), engine: p.engine }, null));
}

/** The plan for a video voiceover: nothing runs, and nothing is spent. */
async function voiceover_plan({ form, send, workspace }) {
  if (workspace !== 'audio') return send('<div class="msg error">Voices are generated in the audio workspace.</div>', 400);
  const found = await voice.loadEngines();
  const p = voice.plan({ ...form, kind: 'video' }, found.engines);
  if (p.error) return send(`<div class="msg error">${esc(p.error)}</div>`, 400);
  return send(voice.planHtml(p, found));
}

module.exports = { '/actions/generate-voice': generate_voice, '/actions/voiceover-plan': voiceover_plan };
