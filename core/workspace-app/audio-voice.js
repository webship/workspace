/**
 * Generate a voice, from the audio workspace.
 *
 * The form offers the engines this machine can use, and what each offers follows the keys it holds:
 * ElevenLabs appears when a key is set, lists the voices that key may read, and says how many credits
 * are left. Piper is the voice-narration skill's local voice. The dashboard decides nothing about
 * either: `audio/cmd-tools-voice.sh` does the work, the same command a person runs by hand.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const { esc } = require('./html');
const { ROOT, workspaceDir } = require('./workspaces');
const transcripts = require('./transcripts');
const { VIDEO_RE } = require('./format');

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const MAX_TEXT = 5000;
const MAX_SCRIPT = 60000;
const MAX_PROMPT = 1000;
const HEADING = /^##\s+(\S+)\s+(.+?)\s+\(((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)\s+to\s+((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)\)\s*$/;
const SPEECH_CHARS_PER_SECOND = 15;

const script = () => path.join(workspaceDir('audio'), 'cmd-tools-voice.sh');

/** What the command says about each engine, as parsed JSON; `error` when it could not be asked. */
function loadEngines() {
  return new Promise((resolve) => {
    execFile('bash', [script(), '-a', 'engines', '--json'],
      { cwd: workspaceDir('audio'), timeout: 45000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return resolve({ engines: [], error: String(stderr || err.message).trim().slice(-300) });
        try { resolve({ engines: JSON.parse(stdout).engines || [] }); } catch (_) { resolve({ engines: [], error: 'The voice command answered with something unreadable.' }); }
      });
  });
}

/**
 * The engines the form offers. Piper runs on the host through the screen runner, and from the
 * dashboard's container its binary and models are not visible, so it is offered whenever the
 * voice-narration catalog is, with the models checked when it runs on the host.
 */
function offered(engines) {
  return engines.map((e) => {
    if (e.id === 'piper' && !e.available && ['no-binary', 'no-voices'].includes(e.reason_code) && e.voices.length) {
      return { ...e, available: true, hostOnly: true, formats: ['wav', 'mp3'] };
    }
    return e;
  });
}


/** What the video mode can pick from: the recordings and the scripts already in the workspace. */
function choices() {
  const list = (key, keep) => {
    const dir = workspaceDir(key);
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && keep(e.name))
        .map((e) => ({ name: e.name, mtime: fs.statSync(path.join(dir, e.name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime).slice(0, 80).map((e) => e.name);
    } catch (_) { return []; }
  };
  return {
    videos: list('videos', (n) => VIDEO_RE.test(n) && !n.startsWith('.')),
    scripts: list('docs', (n) => /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(n) && /(voiceover|script|transcript)/i.test(n)),
  };
}

const seconds = (stamp) => stamp.split(':').reduce((t, part) => t * 60 + parseFloat(part), 0);

/** The spoken lines of a script, by section. A transcript with no timed headings is one untimed block. */
function parseScript(text) {
  const clean = (line) => line.replace(/^>\s?/, '').replace(/\*\(optional\)\*\s*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').trim();
  const lines = String(text).split('\n');
  if (!lines.some((l) => HEADING.test(l))) {
    const spoken = lines.map((l) => l.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)/, '').trim()).filter((l) => l && !l.startsWith('#'));
    return { timed: false, sections: [], characters: spoken.join(' ').length };
  }
  const sections = [];
  for (const line of lines) {
    const h = line.match(HEADING);
    if (h) { sections.push({ id: h[1], title: h[2], window: seconds(h[4]) - seconds(h[3]), chars: 0 }); continue; }
    if (sections.length && line.startsWith('> ')) {
      const t = clean(line);
      sections[sections.length - 1].chars += t.length + (sections[sections.length - 1].chars ? 1 : 0);
    }
  }
  return { timed: true, sections, characters: sections.reduce((n, x) => n + x.chars, 0) };
}

/** A file name not taken in `dir`. */
function freeNameIn(dir, base, ext) {
  let name = base;
  for (let n = 2; fs.existsSync(path.join(dir, `${name}.${ext}`)); n += 1) name = `${base}-${n}`;
  return `${name}.${ext}`;
}

const slugOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

/** A file name in audio/voices/ that is not taken. */
function freeName(base, ext) {
  const dir = path.join(workspaceDir('audio'), 'voices');
  let name = base;
  for (let n = 2; fs.existsSync(path.join(dir, `${name}.${ext}`)); n += 1) name = `${base}-${n}`;
  return `${name}.${ext}`;
}

/** `piper:<id>` or `elevenlabs:<id>`, the value of the voice dropdown, or null. */
function splitChoice(value) {
  const found = String(value || '').match(/^(piper|elevenlabs):(.*)$/);
  return found ? { engine: found[1], id: found[2] } : null;
}

/**
 * The one voice dropdown: ElevenLabs voices first (what the key may read), then Piper's. `selected` is the
 * value to preselect: the configured ElevenLabs default when there is one, else the first Piper voice.
 */
function voiceChoices(engines) {
  const piper = engines.find((e) => e.id === 'piper' && e.available);
  const eleven = engines.find((e) => e.id === 'elevenlabs' && e.available);
  const els = !eleven ? [] : eleven.can_list_voices
    ? eleven.voices.map((v) => [`elevenlabs:${v.id}`, voiceLabel(v)])
    : [[`elevenlabs:${eleven.default_voice || ''}`, eleven.default_voice ? `Voice ${eleven.default_voice}` : 'ElevenLabs: paste a voice id below']];
  const pipers = !piper ? [] : piper.voices.filter((v) => v.installed || piper.hostOnly).map((v) => [`piper:${v.id}`, `${v.number ? `${v.number}. ` : ''}${v.id} — ${v.label}`]);
  const preferred = eleven && eleven.default_voice ? `elevenlabs:${eleven.default_voice}` : '';
  const selected = [preferred, (pipers[0] || [])[0], (els[0] || [])[0]].find((v) => v && [...els, ...pipers].some((o) => o[0] === v)) || '';
  const group = (label, items) => (items.length ? `<optgroup label="${esc(label)}">${items.map((o) => option(o[0], o[1], o[0] === selected)).join('')}</optgroup>` : '');
  const credits = eleven && eleven.remaining != null ? ` · ${Number(eleven.remaining).toLocaleString('en-US')} left on the ${eleven.plan} plan` : '';
  return { html: `${group(`ElevenLabs — uses credits${credits}`, els)}${group('Piper — free, on this machine', pipers)}`, selected, count: els.length + pipers.length };
}

/** The voice and model a form chose for an engine, or `{ error }`. */
function resolveVoice(form, engine) {
  if (engine.id === 'piper') {
    const voice = String(form.piper_voice || '');
    if (!engine.voices.some((v) => v.id === voice)) return { error: 'Choose one of the Piper voices.' };
    return { voice, model: '' };
  }
  const voice = String(form.el_voice_id || form.el_voice || '').trim();
  if (!ID_RE.test(voice)) return { error: 'Choose a voice, or give a voice id.' };
  if (engine.can_list_voices && !engine.voices.some((v) => v.id === voice)) return { error: 'That voice is not on this account.' };
  // A model typed in beside the list wins: ElevenLabs adds models faster than a list can follow.
  const other = String(form.el_model_other || '').trim();
  if (other) return ID_RE.test(other) ? { voice, model: other } : { error: 'That is not a model id: letters, digits, dots, dashes and underscores.' };
  const model = String(form.el_model || engine.default_model || '');
  if (!ID_RE.test(model) || !engine.models.some((m) => m.id === model)) return { error: 'Choose one of the models.' };
  return { voice, model };
}

/**
 * What a submitted form asks for, checked against the engines on offer. Returns `{ error }` or the
 * request with its output file; nothing is written or run here. `kind` is a text spoken to a file, or
 * (`video`) a script spoken over a video and saved as a new video.
 */
function planSound(form, engines) {
  const music = form.kind === 'music';
  const text = String(form.text || '').replace(/\r\n/g, '\n').replace(/\0/g, '').trim();
  if (!text) return { error: music ? 'Describe the music.' : 'Describe the sound.' };
  if (text.length > MAX_PROMPT) return { error: `That is ${text.length} characters; a description takes at most ${MAX_PROMPT}.` };
  const engine = offered(engines).find((e) => e.id === 'elevenlabs');
  if (!engine || !engine.available) return { error: `ElevenLabs is not available: ${(engine && engine.reason) || 'no key is set'}` };
  const name = slugOf(form.name);
  const base = name || `${slugOf(text.split(/\s+/).slice(0, 4).join(' ')) || (music ? 'music' : 'sound')}-${music ? 'music' : 'sound'}`;
  const out = { engine: 'elevenlabs', kind: form.kind, text, characters: text.length, ext: 'mp3', voice: '', model: '', name,
    file: freeNameIn(path.join(workspaceDir('audio'), 'sounds'), base, 'mp3') };
  if (music) {
    const length = parseFloat(form.length || '30');
    if (!(length >= 3 && length <= 600)) return { error: 'Music runs from 3 to 600 seconds.' };
    return { ...out, length, instrumental: form.instrumental === 'yes' };
  }
  const duration = form.duration && form.duration !== 'auto' ? parseFloat(form.duration) : null;
  if (duration !== null && !(duration >= 0.5 && duration <= 30)) return { error: 'A sound runs from 0.5 to 30 seconds.' };
  const influence = form.influence === undefined || form.influence === '' ? 0.3 : parseFloat(form.influence);
  if (!(influence >= 0 && influence <= 1)) return { error: 'How closely to follow the description is between 0 and 1.' };
  return { ...out, duration, influence, loop: form.loop === 'yes' };
}

function plan(form, engines) {
  if (form.kind === 'sound' || form.kind === 'music') return planSound(form, engines);
  const video = form.kind === 'video';
  const text = String(form.text || '').replace(/\r\n/g, '\n').replace(/\0/g, '').trim();
  if (!video) {
    if (!text) return { error: 'Type what the voice should say.' };
    if (text.length > MAX_TEXT) return { error: `That is ${text.length} characters; one voice takes at most ${MAX_TEXT}.` };
  }
  const picked = splitChoice(form.voice_choice);
  const asked = picked ? { ...form, engine: picked.engine, ...(picked.engine === 'piper' ? { piper_voice: picked.id } : { el_voice: picked.id }) } : form;
  const engine = offered(engines).find((e) => e.id === asked.engine);
  if (!engine) return { error: 'Choose a voice.' };
  if (!engine.available) return { error: `${engine.label} is not available: ${engine.reason}` };
  const chosen = resolveVoice(asked, engine);
  if (chosen.error) return chosen;
  const name = slugOf(form.name);
  const common = { engine: engine.id, voice: chosen.voice, model: chosen.model, name };
  if (!video) {
    const ext = engine.id === 'piper' ? ((engine.formats || ['wav']).includes(form.piper_format) ? form.piper_format : 'wav') : 'mp3';
    const base = name || `${slugOf(text.split(/\s+/).slice(0, 4).join(' ')) || 'voice'}-${engine.id}`;
    return { ...common, kind: 'text', text, ext, characters: text.length, file: freeName(base, ext) };
  }
  const have = choices();
  const clip = String(form.video || '');
  if (!have.videos.includes(clip)) return { error: 'Choose a video.' };
  // A script chosen from the list wins; pasted text is used only when none is chosen.
  const scriptName = String(form.script_file || '');
  let script = text;
  let scriptPath = null;
  if (scriptName) {
    if (!have.scripts.includes(scriptName)) return { error: 'Choose a script, or paste one.' };
    scriptPath = path.join(workspaceDir('docs'), scriptName);
    try { script = fs.readFileSync(scriptPath, 'utf8'); } catch (_) { return { error: 'That script cannot be read.' }; }
  } else if (!script) {
    return { error: 'Choose a script, or paste one.' };
  }
  if (script.length > MAX_SCRIPT) return { error: `That script is ${script.length} characters; the limit is ${MAX_SCRIPT}.` };
  const parsed = parseScript(script);
  if (!parsed.characters) return { error: 'The script has nothing to say.' };
  const stem = clip.replace(/\.[^.]+$/, '');
  const base = name || `${slugOf(stem)}-${engine.id}-voice`;
  return { ...common, kind: 'video', ext: 'mp4', video: clip, script, scriptPath, scriptName, scriptLabel: scriptName || 'pasted text', parsed, characters: parsed.characters,
    file: freeNameIn(workspaceDir('videos'), base, 'mp4') };
}

/** The line the host runs. Every value in it has passed ID_RE or is a path this module made. */
function commandLine(p, textFile, confirm) {
  const q = (a) => JSON.stringify(a);
  let args;
  let out;
  if (p.kind === 'sound' || p.kind === 'music') {
    out = path.join(workspaceDir('audio'), 'sounds', p.file);
    args = ['-a', p.kind, '--text-file', textFile, '--out', out];
    if (p.kind === 'music') args.push('--length', String(p.length), ...(p.instrumental ? ['--instrumental'] : []));
    else args.push('--influence', String(p.influence), ...(p.duration !== null ? ['--duration', String(p.duration)] : []), ...(p.loop ? ['--loop'] : []));
    if (confirm) args.push('--confirm');
  } else if (p.kind === 'video') {
    out = path.join(workspaceDir('videos'), p.file);
    args = ['-a', 'voiceover', '--engine', p.engine, '--script', p.scriptPath || textFile,
      '--video', path.join(workspaceDir('videos'), p.video), '--out', out, '--voice', p.voice];
  } else {
    out = path.join(workspaceDir('audio'), 'voices', p.file);
    args = ['-a', 'speak', '--engine', p.engine, '--text-file', textFile, '--out', out, '--voice', p.voice];
  }
  if (p.model) args.push('--model', p.model);
  if (p.kind !== 'sound' && p.kind !== 'music' && confirm && (p.engine === 'elevenlabs' || p.kind === 'video')) args.push('--confirm');
  const run = `bash cmd-tools-voice.sh ${args.map(q).join(' ')}`;
  const made = `mkdir -p ${q(path.dirname(out))}`;
  if (!textFile) return `${made} && ${run}`;
  // The text file is removed whether it worked or not, and the exit status is the command's own.
  const dir = path.dirname(textFile);
  return `${made} && { ${run} && rm -rf ${q(dir)} || { rm -rf ${q(dir)}; false; }; }`;
}

/**
 * The text goes through a file in a private directory, never through a command line. The directory is
 * under the workspace, not /tmp: the dashboard runs in a container and the command on the host, and
 * the workspace is the one place both see.
 */
function writeText(text) {
  const parent = path.join(ROOT, '.screens', 'voice-text');
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const dir = fs.mkdtempSync(path.join(parent, 'v-'));
  const file = path.join(dir, 'text.txt');
  fs.writeFileSync(file, `${text}\n`, { mode: 0o600 });
  return file;
}

const option = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;

function voiceLabel(v) {
  const l = v.labels || {};
  const about = [l.gender, l.accent, l.descriptive].filter(Boolean).join(', ');
  return `${v.label}${about ? ` — ${about}` : ''}`;
}


/** The form for a sound effect or a piece of music: a description, and what ElevenLabs lets you set. */
function soundFormHtml(result, mode) {
  const music = mode === 'music';
  const eleven = offered(result.engines).find((e) => e.id === 'elevenlabs');
  const title = music ? 'Generate music' : 'Generate a sound';
  if (!eleven || !eleven.available) {
    return `
    <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
      <h3 class="uk-margin-small-bottom">${title}</h3>
      <div class="msg error">${music ? 'Music' : 'Sounds'} come from ElevenLabs, which is not available: ${esc((eleven && eleven.reason) || 'no key is set')}</div>
      <p class="uk-text-meta">Add an ElevenLabs key at /settings. It needs permission for ${music ? 'music' : 'sound effects'}.</p>
      <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
    </div>`;
  }
  // The label sits beside the control, not on it, so the control needs its own name.
  const NAMES = { duration: 'Length of the sound', influence: 'How closely to follow the description', length: 'Length of the music' };
  const choices = (name, values, label, selected) => `<select class="uk-select" name="${name}" aria-label="${esc(NAMES[name] || name)}">${values.map((v) => option(v[0], v[1], v[0] === selected)).join('')}</select>`;
  const options = music
    ? `<div class="uk-grid-small" uk-grid>
         <div class="uk-width-1-3@s"><label class="uk-form-label">Length</label>${choices('length', [['10', '10 seconds'], ['15', '15 seconds'], ['30', '30 seconds'], ['60', '1 minute'], ['120', '2 minutes'], ['180', '3 minutes']], '', '30')}</div>
         <div class="uk-width-2-3@s uk-flex uk-flex-bottom"><label><input class="uk-checkbox" type="checkbox" name="instrumental" value="yes" checked> Instrumental, no vocals</label></div>
       </div>`
    : `<div class="uk-grid-small" uk-grid>
         <div class="uk-width-1-3@s"><label class="uk-form-label">Length</label>${choices('duration', [['auto', 'Chosen by ElevenLabs'], ['1', '1 second'], ['2', '2 seconds'], ['3', '3 seconds'], ['5', '5 seconds'], ['10', '10 seconds'], ['15', '15 seconds'], ['30', '30 seconds']], '', 'auto')}</div>
         <div class="uk-width-1-3@s"><label class="uk-form-label">Follow the description</label>${choices('influence', [['0.1', 'Loosely'], ['0.3', 'Normally'], ['0.7', 'Closely']], '', '0.3')}</div>
         <div class="uk-width-1-3@s uk-flex uk-flex-bottom"><label><input class="uk-checkbox" type="checkbox" name="loop" value="yes"> A seamless loop</label></div>
       </div>`;
  return `
    <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
      <h3 class="uk-margin-small-bottom">${title}</h3>
      <p class="uk-text-meta">Saved in <code>audio/sounds/</code> with its description and a record of how it was made. ${eleven.remaining != null ? `${Number(eleven.remaining).toLocaleString('en-US')} credits left on the ${esc(eleven.plan)} plan.` : ''}</p>
      <form id="voice-form" class="voice-form" hx-post="/actions/generate-voice" hx-target="#voice-result" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="audio">
        <input type="hidden" name="kind" value="${music ? 'music' : 'sound'}">
        <input type="hidden" name="engine" value="elevenlabs">
        <textarea class="uk-textarea" name="text" rows="4" maxlength="${MAX_PROMPT}" required data-mic="1" data-voice-text
                  placeholder="${music ? 'Describe the music: mood, instruments, tempo, what it is for.' : 'Describe the sound: what makes it, where, how.'}"></textarea>
        <p class="uk-text-meta uk-margin-remove-top"><span data-voice-count>0</span> of ${MAX_PROMPT} characters</p>
        <input class="uk-input uk-margin-small-bottom" name="name" placeholder="file name (optional)" pattern="[A-Za-z0-9 _.\\-]{0,60}">
        ${options}
        <p class="uk-text-meta uk-margin-small-top">Spends ElevenLabs credits, by the length of what it makes, and needs the ${music ? 'music' : 'sound effects'} permission on the key. You are asked before anything is sent.</p>
        <div class="uk-margin-small-top">
          <button type="button" class="uk-button uk-button-primary arm-step" hx-post="/actions/generate-voice" hx-include="#voice-form" hx-vals='{"confirm":"yes"}'
              hx-target="#voice-result" hx-swap="innerHTML" hx-trigger="confirmed-remove" title="${music ? 'Generate music' : 'Generate a sound'} with ElevenLabs, which spends credits"><span uk-icon="icon: ${music ? 'play' : 'bell'}; ratio: .8"></span> ${music ? 'Generate music' : 'Generate the sound'}</button>
          <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
        </div>
      </form>
      <div id="voice-result" class="uk-margin-top"></div>
    </div>`;
}

/** The Generate form, from what the command found. */
function formHtml(result, mode = 'voice', preset = {}) {
  if (mode === 'sound' || mode === 'music') return soundFormHtml(result, mode);
  const video = mode === 'video';
  const engines = offered(result.engines);
  const have = choices();
  const choice = voiceChoices(engines);
  const first = engines.find((e) => e.id === (choice.selected.split(':')[0] || ''));
  const tag = (id) => (id === (first && first.id) ? '' : ' hidden');
  const piper = engines.find((e) => e.id === 'piper');
  const eleven = engines.find((e) => e.id === 'elevenlabs');
  const off = engines.filter((e) => !e.available).map((e) => `<p class="uk-text-meta uk-margin-remove"><strong>${esc(e.label)}</strong> is not available: ${esc(e.reason)}</p>`).join('');
  const picker = `
        <div class="uk-grid-small" uk-grid><div class="uk-width-expand@s"><label class="uk-form-label" for="voice_choice">Voice</label>
          <select class="uk-select" id="voice_choice" name="voice_choice"${choice.count ? '' : ' disabled'}>${choice.html}</select></div></div>${off}`;

  const piperPane = piper && piper.available ? `
      <div data-engine-pane="piper"${tag('piper')}>
        <div class="uk-grid-small" uk-grid>
          <div class="uk-width-small@s"><label class="uk-form-label" for="piper_format">Format</label>
            <select class="uk-select" id="piper_format" name="piper_format">${(piper.formats || ['wav']).map((f) => option(f, f.toUpperCase(), f === 'wav')).join('')}</select></div>
        </div>
        <p class="uk-text-meta uk-margin-small-top">${piper.hostOnly ? 'Runs on your machine through the host runner, with the voices the voice-narration skill installed there.' : 'Runs here, offline.'}</p>
      </div>` : '';

  const elevenPane = eleven && eleven.available ? `
      <div data-engine-pane="elevenlabs"${tag('elevenlabs')}>
        <div class="uk-grid-small" uk-grid>
          ${eleven.can_list_voices ? '' : `<div class="uk-width-expand@s"><label class="uk-form-label" for="el_voice_id">Voice id</label>
            <input class="uk-input" id="el_voice_id" name="el_voice_id" placeholder="voice id" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{0,79}" value="${esc(eleven.default_voice || '')}"></div>`}
          <div class="uk-width-expand@s"><label class="uk-form-label" for="el_model">Model</label>
            <select class="uk-select" id="el_model" name="el_model">${eleven.models.map((m) => option(m.id, m.label, m.id === eleven.default_model)).join('')}</select></div>
          <div class="uk-width-medium@s"><label class="uk-form-label" for="el_model_other">Or another model id</label>
            <input class="uk-input" id="el_model_other" name="el_model_other" placeholder="eleven_…" pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{0,79}"></div>
        </div>
        <p class="uk-text-meta uk-margin-small-top">Spends ElevenLabs credits. ${eleven.can_list_voices ? '' : 'This key cannot list voices: paste a voice id from your ElevenLabs account. '}${eleven.can_read_account ? '' : 'This key cannot read the account, so the credits left are not shown. '}You are asked before anything is sent.</p>
      </div>` : '';

  const none = !first ? '<div class="msg error">No engine is available. Add an ElevenLabs key at /settings, or install the voice-narration skill.</div>' : '';
  const failed = result.error ? `<div class="msg error">Could not ask the voice command: ${esc(result.error)}</div>` : '';

  return `
    <div class="uk-card uk-card-default uk-card-body uk-margin-top editor-card">
      ${preset.head || `<div class="modal-head"><h3 class="uk-margin-small-bottom">${video ? 'Voice over a video' : 'Generate a voice'}</h3></div>`}
      ${failed}${none}
      <form id="voice-form" class="voice-form" hx-post="/actions/generate-voice" hx-target="#voice-result" hx-swap="innerHTML">
        <input type="hidden" name="workspace" value="audio">
        <input type="hidden" name="kind" value="${video ? 'video' : 'text'}">
        ${video ? `<div data-mode-pane="video">
          <div class="uk-grid-small" uk-grid>
            <div class="uk-width-1-2@s"><label class="uk-form-label" for="voice_video">Video</label>
              <select class="uk-select" id="voice_video" name="video">${have.videos.map((v, i) => option(v, v, preset.video ? v === preset.video : !i)).join('')}</select></div>
            <div class="uk-width-1-2@s"><label class="uk-form-label" for="voice_script">Script</label>
              <select class="uk-select" id="voice_script" name="script_file">${option('', '— paste one below —', false)}${have.scripts.map((v) => option(v, v, v === preset.script)).join('')}</select></div>
          </div>
          <p class="uk-text-meta uk-margin-small-top">${have.videos.length ? 'A timed voiceover script puts each section in its window. Any other transcript is spread over the whole video. The original video is not changed.' : 'There is no video in the videos workspace yet.'}</p>
        </div>` : ''}
        <textarea class="uk-textarea" name="text" rows="5" maxlength="${video ? MAX_SCRIPT : MAX_TEXT}" data-mic="1" data-voice-text
                  placeholder="${video ? 'Paste a voiceover script or a transcript here, or choose one above.' : 'What should the voice say?'}"></textarea>
        <p class="uk-text-meta uk-margin-remove-top"><span data-voice-count>0</span> characters</p>
        <input class="uk-input uk-margin-small-bottom" name="name" placeholder="name of the new file (optional)" pattern="[A-Za-z0-9 _.\\-]{0,60}">
        ${picker}
        ${piperPane}${elevenPane}
        ${preset.ask || ''}
        <div class="modal-actions">
          ${piper && piper.available ? `<button type="submit" class="uk-button uk-button-primary" data-engine-button="piper" data-mode-button="text"${tag('piper')}${video ? ' hidden' : ''}><span uk-icon="icon: microphone; ratio: .8"></span> Generate</button>` : ''}
          ${eleven && eleven.available ? `<button type="button" class="uk-button uk-button-primary arm-step" data-engine-button="elevenlabs" data-mode-button="text"${tag('elevenlabs')}${video ? ' hidden' : ''}
              hx-post="/actions/generate-voice" hx-include="#voice-form" hx-vals='{"confirm":"yes"}' hx-target="#voice-result" hx-swap="innerHTML"
              hx-trigger="confirmed-remove" title="Generate a voice with ElevenLabs, which spends credits"><span uk-icon="icon: microphone; ratio: .8"></span> Generate with ElevenLabs</button>` : ''}
          ${video ? `<button type="button" class="uk-button uk-button-primary" data-plan-button hx-post="/actions/voiceover-plan" hx-include="#voice-form"
              hx-target="#voice-plan" hx-swap="innerHTML"${have.videos.length ? '' : ' disabled'}><span uk-icon="icon: list; ratio: .8"></span> Check the plan</button>` : ''}
          ${preset.askButton || ''}
          <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
        </div>
      </form>
      <div id="voice-plan" class="uk-margin-top"></div>
      <div id="voice-result" class="uk-margin-top"></div>
    </div>`;
}

// ---- generating, inside the modal --------------------------------------------------------------------

const KIND_DIR = { text: ['audio', 'voices'], sound: ['audio', 'sounds'], music: ['audio', 'sounds'], video: ['videos', ''] };
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const SESSION_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const GRACE_MS = 4000;
const GIVE_UP_MS = 15 * 60 * 1000;

/** The last few lines of the session's log, without terminal escapes. */
function logTail(session) {
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.screens', `${session}.log`), 'utf8').slice(-4000);
    return raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).slice(-4)
      .map((l) => l.slice(0, 220)).join('\n');
  } catch (_) { return ''; }
}

/** Where a generation stands: running, done (the file is there with its record) or failed (the session is gone, the file is not). */
function generationState(q) {
  const where = KIND_DIR[q.kind];
  if (!where || !FILE_RE.test(String(q.file || '')) || !SESSION_RE.test(String(q.session || ''))) return null;
  const dir = where[1] ? path.join(workspaceDir(where[0]), where[1]) : workspaceDir(where[0]);
  const file = String(q.file);
  const stem = file.replace(/\.[^.]+$/, '');
  const age = Date.now() - (parseInt(q.t0, 10) || Date.now());
  const { hostSessionsFile } = require('./jobs');
  const hosts = hostSessionsFile();
  const running = hosts ? (hosts.sessions || []).some((s) => s.session === q.session) : null;
  const made = fs.existsSync(path.join(dir, file));
  const record = fs.existsSync(path.join(dir, `${stem}.json`));
  const base = { dir, where, file, stem, age, log: logTail(q.session) };
  if (made && (q.kind === 'video' ? (running === false || (running === null && age > 60000)) : (record || running === false))) return { ...base, status: 'done' };
  if (!made && running === false && age > GRACE_MS) return { ...base, status: 'failed' };
  if (age > GIVE_UP_MS) return { ...base, status: 'failed', slow: true };
  return { ...base, status: 'running' };
}

const ENGINE_LABELS = { piper: 'Piper', elevenlabs: 'ElevenLabs' };
const generationUrl = (q) => `/fragments/audio/generation?${new URLSearchParams({ kind: q.kind, file: q.file, session: q.session, t0: String(q.t0), engine: q.engine || '', edit: q.edit || '' })}`;

/** The answer to pressing Generate: the modal says it is working, and asks again every second. */
function progressHtml(q, state) {
  const label = ENGINE_LABELS[q.engine] || 'the engine';
  const secs = state ? Math.round(state.age / 1000) : 0;
  return `
    <div class="voice-progress" hx-get="${esc(generationUrl(q))}" hx-trigger="load delay:1s" hx-swap="outerHTML" hx-target="this">
      <p><span uk-spinner="ratio: .7"></span> Making <strong>${esc(q.file)}</strong>${q.edit ? '' : ` with ${esc(label)}`} <span class="uk-text-meta">${secs} s</span></p>
      ${state && state.log ? `<pre class="voice-log">${esc(state.log)}</pre>` : ''}
      <p class="uk-text-meta">It runs on this machine and keeps going if you close this window. <a href="/screens">Watch the session</a></p>
    </div>`;
}

/**
 * What the polling asks for. `hrefFor` turns a file in the output folder into its address.
 * Returns `{ html, done }`; `done` is true when the list behind the modal should refresh.
 */
function generationHtml(q, hrefFor) {
  const state = generationState(q);
  if (!state) return null;
  if (state.status === 'running') return { html: progressHtml(q, state), done: false };
  if (state.status === 'failed') {
    return { done: false, html: `
    <div class="msg error voice-failed">
      <p><strong>${esc(q.file)}</strong> was not made${state.slow ? ': it is taking too long to wait for here' : ''}.</p>
      ${state.log ? `<pre class="voice-log">${esc(state.log)}</pre>` : '<p class="uk-text-meta">The session left no log.</p>'}
    </div>` };
  }
  const video = q.kind === 'video';
  const src = hrefFor(state.file);
  const sound = video ? '' : transcripts.soundCardHtml(state.dir, state.stem, hrefFor) || '';
  const again = { text: 'voice', video: 'video', sound: 'sound', music: 'music' }[q.kind];
  return { done: true, html: `
    <div class="voice-done">
      <p><span uk-icon="icon: check; ratio: .9"></span> <strong>${esc(state.file)}</strong> is ready, in <code>${esc(state.where[0])}/${esc(state.where[1] ? `${state.where[1]}/` : '')}</code>.</p>
      ${video ? `<video class="video-player" controls preload="metadata" playsinline src="${esc(src)}"></video>` : `<audio class="sound-player" controls preload="metadata" src="${esc(src)}"></audio>`}
      ${sound}
      <div class="uk-margin-small-top">
        ${q.edit ? `<button type="button" class="uk-button uk-button-default" hx-get="${esc(`/fragments/videos/edit?${new URLSearchParams({ file: state.file, mode: 'pace' })}`)}" hx-target="#editor-modal-body" hx-swap="innerHTML">Edit this version</button>`
    : `<button type="button" class="uk-button uk-button-default" hx-get="/fragments/audio/new?mode=${again}" hx-target="#editor-modal-body" hx-swap="innerHTML">Make another</button>`}
        <button type="button" class="uk-button uk-button-default uk-modal-close">Close</button>
      </div>
    </div>` };
}

const money = (n) => Number(n).toLocaleString('en-US');

/** What a video voiceover would do, shown before anything runs, with the button that runs it. */
function planHtml(p, found) {
  const engine = offered(found.engines).find((e) => e.id === p.engine);
  const spends = p.engine === 'elevenlabs';
  const rows = p.parsed.timed ? p.parsed.sections.map((x) => {
    const rough = x.chars / SPEECH_CHARS_PER_SECOND;
    const note = rough > x.window * 1.05 ? 'may run long' : '';
    return `<tr><td>${esc(x.id)}</td><td>${esc(x.title)}</td><td class="uk-text-right">${x.window.toFixed(1)}s</td><td class="uk-text-right">${x.chars}</td>
        <td class="uk-text-right">${rough.toFixed(1)}s</td><td>${note ? `<span class="uk-text-warning">${note}</span>` : ''}</td></tr>`;
  }).join('') : '';
  const table = p.parsed.timed ? `
      <table class="uk-table uk-table-small uk-table-divider">
        <thead><tr><th>#</th><th>Section</th><th class="uk-text-right">Window</th><th class="uk-text-right">Characters</th><th class="uk-text-right">About</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>` : '<p>A transcript with no timings: it is spread over the whole video as one section.</p>';
  const short = spends && engine && engine.remaining != null && engine.remaining < p.characters;
  const credits = spends
    ? `<p>Up to <strong>${money(p.characters)}</strong> characters${engine && engine.remaining != null ? ` of the ${money(engine.remaining)} left on the ${esc(engine.plan)} plan` : ''}. ElevenLabs may count credits differently from characters, so check your usage afterwards.${short ? ' <span class="uk-text-danger">That is more than the credits left.</span>' : ''}</p>`
    : '<p>Piper is free and runs on your machine.</p>';
  const label = spends ? `Make the voiceover with ElevenLabs, about ${money(p.characters)} characters of credits` : 'Make the voiceover with Piper';
  const button = spends
    ? `<button type="button" class="uk-button uk-button-primary arm-step" title="${esc(label)}" hx-post="/actions/generate-voice" hx-include="#voice-form"
          hx-vals='{"confirm":"yes"}' hx-trigger="confirmed-remove" hx-target="#voice-result" hx-swap="innerHTML"${short ? ' disabled' : ''}>
          <span uk-icon="icon: play; ratio: .8"></span> Generate with ElevenLabs</button>`
    : `<button type="button" class="uk-button uk-button-primary" title="${esc(label)}" hx-post="/actions/generate-voice" hx-include="#voice-form"
          hx-target="#voice-result" hx-swap="innerHTML"><span uk-icon="icon: play; ratio: .8"></span> Generate with Piper</button>`;
  return `
    <div class="uk-card uk-card-default uk-card-body">
      <h4 class="uk-margin-small-bottom">The plan</h4>
      <p><code>${esc(p.video)}</code> &rarr; <code>videos/${esc(p.file)}</code>, script <code>${esc(p.scriptLabel)}</code>, voice <code>${esc(p.voice)}</code>${p.model ? ` on <code>${esc(p.model)}</code>` : ''}.</p>
      ${table}${credits}
      <p class="uk-text-meta">A section that runs past its window is sped up by at most 8%; more than that stops the run and says which section, and nothing is lost. The picture is copied unchanged.</p>
      ${button}
    </div>`;
}

module.exports = { voiceChoices, splitChoice, generationHtml, progressHtml, generationState, KIND_DIR, loadEngines, offered, plan, commandLine, writeText, formHtml, planHtml, choices, parseScript, ID_RE, MAX_TEXT, MAX_SCRIPT, MAX_PROMPT };
