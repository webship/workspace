/* Tiny progressive-enhancement layer on top of HTMX (no frameworks). */

// Preferences — theme, the rail, the assistant, the page width — are stored by the pre-paint script in
// a COOKIE on the hub domain, because localStorage is per-origin and this dashboard spans
// <workspace>.<hub> subdomains: kept there, the theme was a different theme on every workspace page.
// These two are defined in <head> so the first paint can read them; this is the guard for a page that
// somehow loads this file without it.
const wsPref = window.wsPref || ((name, fallback) => { try { return localStorage.getItem(name) ?? fallback; } catch (_) { return fallback; } });
const wsPrefSet = window.wsPrefSet || ((name, value) => { try { localStorage.setItem(name, value); } catch (_) { /* ignore */ } });

// Every important action — remove, delete, reset to the defaults, a command that asks before it runs — goes through
// one dialog: "Wait! Are you sure you want to proceed with this action?", Yes or No. The button says what it is in
// the dialog, so the answer is given to a named thing rather than to a button that changed its own label.
//
// It replaces a two-step arm, where the first click swapped the label for "⚠️ Sure?" and a second click within five
// seconds went through: a double click did the whole thing, and nothing ever said what was about to happen.
let pendingConfirm = null;

function runConfirmed(btn) {
  pendingConfirm = null;
  if (!btn) return;
  window.htmx && window.htmx.trigger(btn, 'confirmed-remove');
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.arm-step');
  if (!btn) return;
  // Neither this click nor the dialog's may navigate: these are links as well as buttons, and a link with an empty
  // href reloads the page, losing the toast the request answers with.
  e.preventDefault();
  pendingConfirm = btn;
  // What the action is: its title where it has one (an icon-only trash can), else its own label — and what it
  // belongs to, from the row or card it sits in, so "Delete" is never the whole of what the dialog says.
  const label = (btn.getAttribute('title') || btn.dataset.tipHint || btn.textContent || '').replace(/\s+/g, ' ').trim();
  const card = btn.closest('.project-row, .cc-row, #cc-command, .row-item, .editor-card, .settings-row');
  // The card's own heading, whatever that card calls it: a project row has an h3.project-title, a
  // command row a .cmd-title, a file row a bold span. First match wins, and never one inside the button.
  const name = card && [...card.querySelectorAll('.project-title, .cmd-title, h1, h2, h3, .item-row-body .uk-text-bold')]
    .find((el) => !btn.contains(el) && el.textContent.trim());
  const belongsTo = name ? name.textContent.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  const what = belongsTo && !label.includes(belongsTo) ? `${label} — ${belongsTo}` : label;
  const where = document.getElementById('confirm-what');
  if (where) where.textContent = what;
  if (window.UIkit && document.getElementById('confirm-modal')) {
    window.UIkit.modal('#confirm-modal').show();
    return;
  }
  // No UIkit on the page (a fragment rendered on its own): the browser's own dialog rather than acting unasked.
  if (window.confirm(`Are you sure you want to proceed with this action?${what ? `\n\n${what}` : ''}`)) runConfirmed(btn);
  else pendingConfirm = null;
});

document.addEventListener('click', (e) => {
  if (e.target.closest('.confirm-yes')) {
    const btn = pendingConfirm;
    e.preventDefault();
    if (window.UIkit) window.UIkit.modal('#confirm-modal').hide();
    runConfirmed(btn);
  } else if (e.target.closest('.confirm-no')) {
    pendingConfirm = null;
  }
});

// Closing it any other way — the X, Escape, the backdrop — is No.
document.addEventListener('hidden', (e) => {
  if (e.target && e.target.id === 'confirm-modal') pendingConfirm = null;
}, true);

// The field microphones live in public/mic.js — they and the assistant's microphone now read the
// same resolved config (window.WS_SPEECH, from speech.js), so `speech_language` reaches both.


// The icon search. The chooser offers one library, fetched as you type: 4736 tiles
// rendered inline would be a multi-megabyte page, and nobody scans four thousand
// icons — they type.
let iconSearchTimer = null;
document.addEventListener('input', (e) => {
  if (!e.target.closest('.icon-filter')) return;
  // Debounced, so typing a word is one request rather than one per keystroke.
  clearTimeout(iconSearchTimer);
  iconSearchTimer = setTimeout(() => {
    document.body.dispatchEvent(new CustomEvent('search-icons'));
  }, 220);
});

// Give each video the aspect ratio it actually has.
//
// The browser is the only party here that knows a recording's dimensions: the app
// container has no ffprobe/ffmpeg, so the server cannot emit width/height attributes,
// and UIKit's media reset derives `aspect-ratio` from exactly those missing attributes
// (see .video-player in style.css — without a stated ratio the element lays out 2px
// tall). CSS states 16/9 so the box is never zero; this replaces it with the real ratio
// as soon as the metadata arrives, so a 16:10 screencast is not letterboxed for nothing.
function sizeVideoPlayers(scope) {
  (scope || document).querySelectorAll('video.video-player').forEach((v) => {
    const apply = () => {
      if (v.videoWidth && v.videoHeight) v.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
    };
    if (v.readyState >= 1) apply();                            // metadata already in
    v.addEventListener('loadedmetadata', apply, { once: true }); // or when it lands
  });
}

// htmx 4 dispatches htmx:after:swap on the element that MADE the request, not on
// the one that was swapped — the swapped element is what htmx:after:settle names.
// Every listener below wants the element whose content just changed, so it asks
// for it once, here, rather than trusting e.target.
function swappedEl(e) {
  return (e.detail && e.detail.target) || e.target;
}

// Open the editor modal whenever something is swapped into it, and put the list back
// in step when it closes — a save may have renamed or changed what the list shows.
/**
 * In the clone form, the "also answer at <name>-<workspace>" label has to follow
 * the name field: the address is derived from the name, and a label showing
 * "<name>-dev" while the field says "blog2" makes people check the wrong thing.
 */
function wireCloneAddressPreview(root) {
  const scope = root && root.querySelector ? root : document;
  const name = scope.querySelector('form [name="to"]');
  const host = scope.querySelector('.clone-ws-host');
  if (!name || !host || host.dataset.wired === '1') return;
  host.dataset.wired = '1';
  const ws = host.textContent.replace(/^&lt;name&gt;-|^<name>-/, '').replace('.ddev.site', '');
  const paint = () => { host.textContent = `${name.value || '<name>'}-${ws}.ddev.site`; };
  name.addEventListener('input', paint);
  paint();
}

function onEditorSwap(e) {
  const el = swappedEl(e);
  if (!el || !el.id) return;
  if (el.id === 'editor-modal-body' && window.UIkit) {
    // The dropdown the item was clicked in stays open behind — UIkit only closes a
    // dropdown on an outside click, and opening a modal is not one. The result is a
    // menu sitting on top of the dialog it just opened, which reads as a rendering
    // bug. Every row menu that opens this modal has it, so it is closed here rather
    // than by each caller.
    document.querySelectorAll('.uk-dropdown.uk-open').forEach((d) => {
      try { window.UIkit.dropdown(d).hide(false); } catch (_) { /* not a dropdown any more */ }
    });
    // Showing an open modal again is a no-op, so both events may fire.
    window.UIkit.modal('#editor-modal').show();
    sizeVideoPlayers(el);
    wireCloneAddressPreview(el);
  }
  // A save result is short and the editor above it is tall, so scroll it into view —
  // otherwise a successful save is invisible and reads as nothing having happened.
  if (el.id === 'editor-result') {
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    // Keep the list behind the modal in step with what was just written.
    document.body.dispatchEvent(new CustomEvent('refresh-projects'));
  }
}
document.body.addEventListener('htmx:after:swap', onEditorSwap);
document.body.addEventListener('htmx:after:settle', onEditorSwap);

// The Generate voice form shows the options of the mode and engine chosen, and counts what is typed.
document.addEventListener('change', (e) => {
  if (!e.target.matches || !e.target.matches('.voice-form input[name="engine"], .voice-form input[name="kind"], .voice-form select[name="voice_choice"]')) return;
  const form = e.target.form;
  const checked = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value;
  const picker = form.querySelector('select[name="voice_choice"]');
  const engine = picker ? picker.value.split(':')[0] : checked('engine');
  const modeField = form.querySelector('input[name="kind"]:checked, input[type="hidden"][name="kind"]');
  const mode = (modeField && modeField.value) || 'text';
  form.querySelectorAll('[data-engine-pane]').forEach((el) => { el.hidden = el.dataset.enginePane !== engine; });
  form.querySelectorAll('[data-mode-pane]').forEach((el) => { el.hidden = el.dataset.modePane !== mode; });
  form.querySelectorAll('[data-engine-button]').forEach((el) => { el.hidden = el.dataset.engineButton !== engine || (el.dataset.modeButton || 'text') !== mode; });
  form.querySelectorAll('[data-plan-button]').forEach((el) => { el.hidden = mode !== 'video'; });
  const plan = document.getElementById('voice-plan');
  if (plan) plan.innerHTML = '';
});
// A plan is only true for the form it was made from.
['change', 'input'].forEach((type) => document.addEventListener(type, (e) => {
  if (!e.target.closest || !e.target.closest('.voice-form')) return;
  const plan = document.getElementById('voice-plan');
  if (plan) plan.innerHTML = '';
}));
document.addEventListener('input', (e) => {
  if (!e.target.matches || !e.target.matches('[data-voice-text]')) return;
  const n = e.target.form && e.target.form.querySelector('[data-voice-count]');
  if (n) n.textContent = e.target.value.length;
});

// The editor modal is a dialog: named after its heading, and the page behind it is out of reach while it is
// open. Without that, Tab from the last button went to the page behind the overlay and a screen reader had
// a dialog with no name.
function containEditorModal(open) {
  const modal = document.getElementById('editor-modal');
  if (!modal) return;
  for (const el of Array.from(document.body.children)) {
    if (el === modal || el.contains(modal) || el.id === 'confirm-modal' || el.tagName === 'SCRIPT'
        || el.classList.contains('uk-notification')) continue;
    if (open) {
      if (!('wasInert' in el.dataset)) el.dataset.wasInert = el.inert ? '1' : '';
      el.inert = true;
    } else if ('wasInert' in el.dataset) {
      el.inert = el.dataset.wasInert === '1';
      delete el.dataset.wasInert;
    }
  }
}
function nameEditorModal() {
  // UIkit puts role="dialog" aria-modal="true" on the inner .uk-modal-dialog, so that is the one that is named.
  const dialog = document.querySelector('#editor-modal .uk-modal-dialog');
  const h = dialog && dialog.querySelector('.modal-head h3, h3, h2');
  if (dialog && h) dialog.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
}
document.addEventListener('shown', (e) => {
  if (!e.target || e.target.id !== 'editor-modal') return;
  containEditorModal(true);
  nameEditorModal();
});
document.body.addEventListener('htmx:after:swap', (e) => {
  if (swappedEl(e)?.id === 'editor-modal-body') nameEditorModal();
});

document.addEventListener('hidden', (e) => {
  if (!e.target || e.target.id !== 'editor-modal') return;
  containEditorModal(false);
  const body = document.getElementById('editor-modal-body');
  // Pause first: emptying the container detaches the element but a playing video can
  // keep its audio going, which is startling when the modal has visibly closed.
  body?.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch (_) { /* gone already */ } });
  if (body) body.innerHTML = '';          // drop the editor, and any unsaved text with it
  document.body.dispatchEvent(new CustomEvent('refresh-projects'));
});

// Show error responses instead of discarding them.
//
// HTMX only swaps a 2xx by default, so every 4xx this dashboard returns — 67 of them,
// plus 9 fragment ones — was silently dropped: the refused save, the 409 when a
// settings file changed underneath, "Unknown workspace", the bash -n syntax report.
// The user clicked and nothing happened, which reads as the button being broken.
//
// The server already returns a rendered message with each of these, so swap it in and
// let the status stay honest.
document.body.addEventListener('htmx:before:swap', (e) => {
  const status = e.detail.xhr && e.detail.xhr.status;
  if (status >= 400 && status < 600) {
    e.detail.shouldSwap = true;
    e.detail.isError = false;      // it is a handled response, not a transport failure
  }
});

// Copy a shown command to the clipboard. The dashboard prints commands it deliberately does not
// run — MCP registration writes to ~/.claude, which belongs to the person at the keyboard, not to
// a web request — so the useful button is "copy it", not "do it".
document.body.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-cmd');
  if (!btn) return;
  e.preventDefault();
  const text = btn.dataset.copy || (btn.previousElementSibling && btn.previousElementSibling.textContent) || '';
  try {
    await navigator.clipboard.writeText(text.trim());
    const was = btn.innerHTML;
    btn.innerHTML = '<span uk-icon="icon: check; ratio: .7"></span> Copied';
    setTimeout(() => { btn.innerHTML = was; }, 1500);
  } catch (_) {
    // Clipboard access needs a secure context and permission; the command is on screen either way.
    btn.textContent = 'Select and copy it';
  }
});

// Generate SVG: picking an example fills the prompt and the style, and both stay editable.
document.addEventListener('change', (e) => {
  const sel = e.target && e.target.matches && e.target.matches('select[data-svg-example]') ? e.target : null;
  const o = sel && sel.selectedOptions[0];
  if (!o || !o.dataset.prompt) return;
  const form = sel.closest('form');
  const ta = form && form.querySelector('textarea[name="prompt"]');
  if (ta) {
    ta.value = o.dataset.prompt;
    if (ta._aceEditor) ta._aceEditor.setValue(o.dataset.prompt, 1);
  }
  const style = form && form.querySelector('select[name="style"]');
  if (style && o.dataset.style) style.value = o.dataset.style;
});

// An animated SVG in the viewer starts when a quarter of it is in view, and Replay starts it again: an SVG shown
// as an image restarts its animation when it is loaded anew.
function playSvg(img) {
  const src = img.dataset.src || img.getAttribute('src');
  img.setAttribute('src', `${src}${src.includes('?') ? '&' : '?'}play=${Date.now()}`);
}
function watchSvgMotion(root) {
  (root || document).querySelectorAll('img[data-svg-motion]:not([data-svg-watched])').forEach((img) => {
    img.dataset.svgWatched = '1';
    if (!window.IntersectionObserver) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      io.disconnect();
      playSvg(img);
    }, { threshold: Number(img.dataset.threshold) || 0.25 });
    io.observe(img);
  });
}
document.addEventListener('DOMContentLoaded', () => watchSvgMotion());
document.body.addEventListener('htmx:after:settle', () => watchSvgMotion());
document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-svg-replay]');
  if (!btn) return;
  const card = btn.closest('[data-img-viewer]');
  const img = card && card.querySelector('img[data-svg-motion]');
  if (img) playSvg(img);
});

// Opening a menu asks for what is in it NOW.
//
// The screens menu polls in the background so the row's hand and agent badge stay current, and that
// poll is deliberately slow — one request per project row every few seconds is what pinned this
// dashboard once before. Slow in the background is fine as long as OPENING the menu is not: a list of
// sessions is the one thing you open the menu to read, and reading a thirty-second-old one is how you
// end up clicking a session that has already finished.
//
// UIkit emits `beforeshow` on the dropdown, and htmx listens for `menu-opened` on the list inside it.
document.addEventListener('beforeshow', (e) => {
  const list = e.target.querySelector && e.target.querySelector('[hx-trigger*="menu-opened"]');
  if (list) list.dispatchEvent(new CustomEvent('menu-opened'));
}, true);

// A pick closes the menu it was made in.
//
// UIkit closes a dropdown on an OUTSIDE click, and almost nothing these menus do is one: opening a
// modal is not, opening a terminal window is not, and posting an action that swaps the output panel is
// not. So the menu stayed open, floating over the thing it had just opened — which reads as a control
// that did not take, and on the screens menu it sat on top of the terminal it had just started.
//
// This used to be scoped to items carrying `uk-toggle` (the modal openers), which is why the screens
// menu was never covered: its items carry `data-open-terminal` instead. A menu closing when you choose
// something from it is what a menu does, so the rule is now the general one — every link and button
// inside any dropdown. Inputs, selects and labels are deliberately NOT included: a dropdown that holds
// a filter box (the icon picker, the command picker) must stay open while it is being typed in.
document.body.addEventListener('click', (e) => {
  if (!window.UIkit) return;
  const item = e.target.closest('.uk-dropdown a, .uk-dropdown button');
  if (!item) return;
  const drop = item.closest('[uk-dropdown]') || item.closest('.uk-dropdown');
  if (!drop) return;
  // The pager and the filter inside a dropdown-based picker re-render it in place; closing on those
  // would shut the picker on the first page turn.
  if (item.closest('[data-keep-open]')) return;
  try { window.UIkit.dropdown(drop).hide(0); } catch (_) { /* not a dropdown any more */ }
});

// Ace (ajaxorg/ace, BSD-3) for the files that are code: .sh, .yml, .md.
//
// It attaches to a textarea marked data-ace="<mode>" and writes every change straight
// back into it, so every existing form keeps posting the same field and no endpoint
// changed. If Ace fails to load, the textarea is simply still there and still works —
// which is why it replaces rather than removes it.
//
// Loaded on demand: 780KB of editor has no business on a page that is not editing.

// ---------------------------------------------------------------- mentions --
// One fetch per source, cached: the list changes when someone installs an agent,
// not between keystrokes.
const _mentionCache = new Map();
function mentionsFor(url) {
  if (!_mentionCache.has(url)) {
    _mentionCache.set(url, fetch(url).then((r) => r.json()).catch(() => []));
  }
  return _mentionCache.get(url);
}

function attachMentions(ace, editor, url) {
  let tools;
  try { tools = ace.require('ace/ext/language_tools'); } catch (_) { return; }
  if (!tools) return;
  editor.setOptions({ enableBasicAutocompletion: true, enableLiveAutocompletion: true });
  // The same endpoint and the same rules as the composer's popup (suggest.js), so the two
  // fields cannot offer different things: "@" for agents and skills, "/" for commands and
  // skills. It used to be "@" only, and it inserted `@"name (kind)"` — a shape neither the
  // CLI nor the assistant understands, so what you picked was not what you could send.
  let items = { '@': [], '/': [] };
  const load = (trigger) => fetch(`${url}${url.includes('?') ? '&' : '?'}trigger=${encodeURIComponent(trigger)}`,
    { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => { items[trigger] = list || []; })
    .catch(() => { /* no completions; the editor still edits */ });
  load('@');
  load('/');
  tools.addCompleter({
    // Only after a trigger — this is a prompt field, not a code editor, and suggesting on
    // every word would fight the typing.
    identifierRegexps: [/[@/a-zA-Z0-9_.-]/],
    getCompletions(ed, session, pos, prefix, callback) {
      const line = session.getLine(pos.row).slice(0, pos.column);
      let best = null;
      for (const trigger of ['@', '/']) {
        const at = line.lastIndexOf(trigger);
        if (at === -1) continue;
        const before = at === 0 ? '' : line[at - 1];
        if (before && !/\s/.test(before)) continue;      // an email, or a path
        const typed = line.slice(at + 1);
        if (/[\s"']/.test(typed)) continue;              // the token is finished
        if (trigger === '/' && at !== 0 && !/^\s*$/.test(line.slice(0, at))) continue;
        if (!best || at > best.at) best = { trigger, at, typed: typed.toLowerCase() };
      }
      if (!best) return callback(null, []);
      const hits = (items[best.trigger] || [])
        .filter((m) => m.name.toLowerCase().includes(best.typed))
        .slice(0, 40)
        .map((m, _i, arr) => ({
          // The trigger and the name — plus the kind when the name alone is ambiguous.
          // A few items exist as both an agent and a skill and are not interchangeable.
          caption: `${best.trigger}${m.name}${arr.filter((o) => o.name === m.name).length > 1 ? ` (${m.kind})` : ''}`,
          value: `${best.trigger}${m.name}${arr.filter((o) => o.name === m.name).length > 1 ? ` (${m.kind})` : ''}`,
          meta: `${m.kind} · ${m.where}`,
          docHTML: m.description
            ? `<div style="max-width:38rem;white-space:normal">${m.description.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`
            : undefined,
          score: m.where === 'this project' ? 1000 : m.where === 'installed' ? 500 : 100,
        }));
      callback(null, hits);
    },
  });
}

let acePromise = null;
function loadAce() {
  if (acePromise) return acePromise;
  acePromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = '/vendor/ace/ace.js';
    el.onload = () => {
      window.ace.config.set('basePath', '/vendor/ace');
      // Ace resolves worker and mode files itself from basePath; only the yaml worker
      // is vendored, so the others must not be reached for.
      window.ace.config.setModuleUrl('ace/mode/yaml_worker', '/vendor/ace/worker-yaml.js');
      // The completion extension is part of loading Ace, not a race beside it:
      // an editor that mounts first would find no completer to register with.
      const lt = document.createElement('script');
      lt.src = '/vendor/ace/ext-language_tools.js';
      lt.onload = () => resolve(window.ace);
      lt.onerror = () => resolve(window.ace);   // no completions, still an editor
      document.head.appendChild(lt);
    };
    el.onerror = reject;
    document.head.appendChild(el);
  });
  return acePromise;
}

const ACE_MODES = { sh: 'sh', yaml: 'yaml', yml: 'yaml', markdown: 'markdown', md: 'markdown' };

function aceTheme() {
  // settings.yml's style.editor_theme can pin the editor independently of the page:
  // 'auto' follows the mode, 'light'/'dark' force it — a code editor is one place
  // people often want dark even on a light page.
  const forced = document.documentElement.dataset.editorTheme;
  const dark = forced === 'dark' ? true
    : forced === 'light' ? false
    : document.documentElement.classList.contains('dark');
  return dark ? 'ace/theme/tomorrow_night' : 'ace/theme/textmate';
}

function attachAce(root) {
  // A swap can name a target that is not an element (a polling card replaces itself); there is nothing to attach to then.
  if (root && typeof root.querySelectorAll !== 'function') return;
  const fields = (root || document).querySelectorAll('textarea[data-ace]:not([data-ace-ready])');
  if (!fields.length) return;
  // Claim each field NOW, synchronously, before awaiting the loader — the guard above
  // is only honest if it is set before anything can await. Both `htmx:after:swap` and
  // `htmx:after:settle` call this for the same swap, and on the FIRST open Ace is a
  // 780KB fetch: the two calls used to query, both match the same textarea while the
  // load was still in flight, and both attach an editor to it. Two stacked editors, the
  // same prompt visible twice. Never reproducible once Ace is cached, because then the
  // loader resolves in a microtask and the first claim lands before the second event.
  fields.forEach((ta) => { ta.dataset.aceReady = '1'; });
  loadAce().then((ace) => {
    fields.forEach((ta) => {
      const mode = ACE_MODES[ta.dataset.ace] || 'sh';
      // data-ace-single: one line (a command line) — no Enter, no gutter, and a pasted line break becomes a space.
      // readonly: code shown on a page, to read and copy, not to type into.
      const single = ta.dataset.aceSingle === '1';
      const readOnly = ta.readOnly || ta.dataset.aceReadonly === '1';
      const host = document.createElement('div');
      host.className = `ace-host${single ? ' ace-host-single' : ''}${readOnly ? ' ace-host-readonly' : ''}`;
      // A short field (a prompt, a few steps) gets a short editor: the 260px
      // floor is for the file editors, not for a form row. A one-line editor sizes itself.
      if (!single) host.style.height = `${ta.rows <= 8 ? Math.max(90, ta.rows * 19) : Math.max(260, Math.min(620, ta.rows * 19))}px`;
      ta.parentNode.insertBefore(host, ta);
      ta.style.display = 'none';               // kept in the DOM: it is what submits

      const editor = ace.edit(host);
      editor.session.setMode(`ace/mode/${mode}`);
      // "@" offers the agents, skills and prompts this machine and this project
      // actually have — the same names Claude Code answers to, so a prompt can
      // name one without anybody remembering how it is spelled.
      if (ta.dataset.mentions) attachMentions(ace, editor, ta.dataset.mentions);
      editor.setTheme(aceTheme());
      editor.session.setValue(ta.value);
      editor.session.setUseSoftTabs(true);
      editor.session.setTabSize(2);
      editor.setShowPrintMargin(false);
      editor.setOption('useWorker', mode === 'yaml' && !readOnly);   // only the yaml worker is vendored
      if (ta.placeholder && editor.$options && editor.$options.placeholder) editor.setOption('placeholder', ta.placeholder);
      if (single) {
        editor.setOptions({ minLines: 1, maxLines: 1, showGutter: false, highlightActiveLine: false });
        editor.commands.addCommand({ name: 'oneLine', bindKey: { win: 'Enter|Shift-Enter', mac: 'Enter|Shift-Enter' }, exec: () => {} });
        editor.on('paste', (ev) => { ev.text = String(ev.text).replace(/[\r\n]+/g, ' '); });
      }
      if (readOnly) editor.setOptions({ readOnly: true, highlightActiveLine: false, highlightGutterLine: false });
      editor.session.on('change', () => { ta.value = editor.session.getValue(); });
      // An editor drawn inside a closed <details> or a hidden tab has no size yet: draw it again when it gets one.
      if (window.ResizeObserver) new ResizeObserver(() => editor.resize()).observe(host);
      ta._aceEditor = editor;
    });
  }).catch(() => {
    // No Ace: hand the fields back so the textarea is a plain textarea again and a
    // later attempt (another swap) can still try.
    fields.forEach((ta) => { delete ta.dataset.aceReady; });
  });
}

// Add a row and add a button are forms in the modal, and both answer with the rows editor behind it — so the modal
// has nothing left to show. Closed from here rather than with an hx-on on each button, whose `event.detail.successful`
// does not exist in htmx 4. `after:settle` is the event that names the element that was swapped: `after:swap` reports
// the element that MADE the request, which here is the button inside the modal.
document.body.addEventListener('htmx:after:settle', (e) => {
  if (!e.target || e.target.id !== 'row-actions-editor') return;
  if (window.UIkit && document.querySelector('#editor-modal.uk-open')) window.UIkit.modal('#editor-modal').hide();
});

document.addEventListener('DOMContentLoaded', () => attachAce());
// Start AI's prompt gets Ace only once Start AI is ticked, so a workspace page does not load the editor for nothing.
document.addEventListener('change', (e) => {
  const box = e.target && e.target.matches && e.target.matches('input[name="ai_after"]') ? e.target : null;
  if (!box || !box.checked) return;
  const form = box.closest('form');
  const ta = form && form.querySelector('textarea[data-ace-on-demand]:not([data-ace])');
  if (!ta) return;
  ta.dataset.ace = ta.dataset.aceOnDemand;
  attachAce(form);
});
document.body.addEventListener('htmx:after:swap', (e) => attachAce(swappedEl(e)));
document.body.addEventListener('htmx:after:settle', (e) => attachAce(swappedEl(e)));

// Follow the theme toggle, since the editor paints its own background.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-toggle')) return;
  setTimeout(() => {
    document.querySelectorAll('textarea[data-ace-ready]').forEach((ta) => {
      if (ta._aceEditor) ta._aceEditor.setTheme(aceTheme());
    });
  }, 50);
});

// The actions rail. Collapsed state is remembered, like the theme, because it is
// a layout preference and having it reset on every navigation would be noise.
function applyActionsCollapsed(collapsed) {
  document.documentElement.classList.toggle('actions-collapsed', collapsed);
  const toggle = document.querySelector('.actions-toggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.title = collapsed ? 'Expand the actions rail' : 'Collapse the actions rail';
  }
}

// Collapsed is the default: the rail is on every page now, and the content — a
// project table, a diff, a job's output — wants the width more than the labels do.
// Only an explicit '0' (the user expanded it) keeps it open.
try {
  applyActionsCollapsed(wsPref('actions-collapsed', '1') !== '0');
} catch (_) { applyActionsCollapsed(true); }

document.addEventListener('click', (e) => {
  if (!e.target.closest('.actions-toggle')) return;
  const collapsed = !document.documentElement.classList.contains('actions-collapsed');
  applyActionsCollapsed(collapsed);
  wsPrefSet('actions-collapsed', collapsed ? '1' : '0');
});

// The rail's names and its tooltip. Collapsed, a tile is a glyph: its name has to be there for a screen
// reader (aria-label, the visible label) and for the eye (a tooltip, at once and on keyboard focus — the
// native title waits about a second and never shows on focus). The sentence the title held moves to
// aria-description and the tooltip, so nothing is lost and nothing shows twice.
(function railTips() {
  const rail = document.getElementById('actions-rail');
  if (!rail) return;
  rail.querySelectorAll('a.action-btn, button.action-btn').forEach((el) => {
    if (el.classList.contains('actions-version')) return;
    const label = (el.querySelector('.action-label') || {}).textContent;
    if (!label || !label.trim()) return;
    const name = label.replace(/\s+/g, ' ').trim();
    const hint = (el.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
    el.dataset.tipLabel = name;
    el.dataset.tipGroup = ((el.closest('.actions-group') || {}).dataset || {}).group || '';
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', name);
    if (hint && hint !== name) {
      el.dataset.tipHint = hint;
      el.setAttribute('aria-description', hint);
    }
    el.removeAttribute('title');
  });

  let tip = null;
  let shownFor = null;
  const hide = () => { if (tip) tip.hidden = true; shownFor = null; };
  const show = (el) => {
    if (window.innerWidth < 960 || !el.dataset.tipLabel) return;
    const collapsed = document.documentElement.classList.contains('actions-collapsed');
    const head = collapsed ? el.dataset.tipLabel : '';
    const hint = el.dataset.tipHint || '';
    if (!head && !hint) return;
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'rail-tip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    tip.textContent = '';
    if (head) { const b = document.createElement('strong'); b.textContent = head; tip.appendChild(b); }
    if (hint) { const s = document.createElement('span'); s.textContent = hint; tip.appendChild(s); }
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    tip.style.right = `${Math.round(window.innerWidth - r.left + 10)}px`;
    tip.style.top = `${Math.round(Math.max(8, Math.min(window.innerHeight - t.height - 8, r.top + r.height / 2 - t.height / 2)))}px`;
    shownFor = el;
  };
  const tile = (e) => e.target.closest && e.target.closest('#actions-rail a.action-btn, #actions-rail button.action-btn');
  rail.addEventListener('mouseover', (e) => { const el = tile(e); if (el && el !== shownFor) show(el); });
  rail.addEventListener('mouseout', (e) => { if (tile(e)) hide(); });
  rail.addEventListener('focusin', (e) => { const el = tile(e); if (el) show(el); });
  rail.addEventListener('focusout', hide);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  rail.addEventListener('scroll', hide, { passive: true });

  // Whether there is more rail below the fold, so Go and Help are not simply cut off: a fade at the foot
  // while there is, and none once the end is in view.
  const fade = () => {
    const more = rail.scrollHeight - rail.clientHeight - rail.scrollTop > 4;
    rail.classList.toggle('can-scroll', more);
  };
  rail.addEventListener('scroll', fade, { passive: true });
  window.addEventListener('resize', fade);
  document.addEventListener('click', (e) => { if (e.target.closest('.actions-toggle')) setTimeout(fade, 250); });
  fade();
})();

// Tabbed modals (tab-modal.js renders the markup). A tab is a button that loads its fragment into the
// pane; this keeps the one you are on marked, moves between tabs with the arrow keys, filters a long
// list, keeps #<modal>/<tab> in the address for a modal that asks for it, and sends the links inside a
// pane back into the pane rather than away from the page.
(function tabModals() {
  const hashOf = (tm) => tm.hasAttribute('data-hash') ? tm.dataset.tabmodal : '';
  const select = (tm, tab) => {
    tm.querySelectorAll('.tabmodal-tab').forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-selected', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
    });
    const head = tm.querySelector('.tabmodal-heading');
    const sub = tm.querySelector('.tabmodal-sub');
    if (head) head.textContent = tab.dataset.label || '';
    if (sub) sub.textContent = tab.dataset.hint || '';
    const pane = tm.querySelector('.tabmodal-pane');
    if (pane) pane.setAttribute('aria-labelledby', tab.id);
    const h = hashOf(tm);
    if (h) { try { history.replaceState(null, '', `#${h}/${encodeURIComponent(tab.dataset.tab)}`); } catch (_) { /* a sandboxed frame */ } }
  };

  document.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('.tabmodal-tab');
    if (tab) { select(tab.closest('.tabmodal'), tab); return; }

    // A link in a pane that points at another page of the same section loads into the pane.
    const a = e.target.closest && e.target.closest('.tabmodal-pane a[href^="/settings"]');
    if (a && !e.defaultPrevented && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0
        && a.target !== '_blank' && window.htmx) {
      const tm = a.closest('.tabmodal');
      e.preventDefault();
      const u = new URL(a.getAttribute('href'), location.origin);
      u.searchParams.set('fragment', '1');
      window.htmx.ajax('GET', u.pathname + u.search, { target: a.closest('.tabmodal-pane'), swap: 'innerHTML' });
      const seg = decodeURIComponent(u.pathname.replace(/^\/settings\/?/, ''));
      const want = seg === '' ? 'overview' : seg;
      const tab2 = [...tm.querySelectorAll('.tabmodal-tab')].find((t) => t.dataset.tab === want);
      if (tab2) select(tm, tab2);
      return;
    }

    // The rail's tile for a place that also exists as a modal: open it over the page you are on.
    const opener = e.target.closest && e.target.closest('[data-tabmodal-open]');
    if (opener && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0 && window.htmx) {
      e.preventDefault();
      window.htmx.ajax('GET', opener.dataset.tabmodalOpen, { target: '#editor-modal-body', swap: 'innerHTML' });
    }
  });

  document.addEventListener('keydown', (e) => {
    const tab = e.target.closest && e.target.closest('.tabmodal-tab');
    if (!tab || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const tabs = [...tab.closest('.tabmodal').querySelectorAll('.tabmodal-tab')].filter((t) => !t.hidden && t.offsetParent);
    const i = tabs.indexOf(tab);
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1]
      : tabs[Math.min(tabs.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (next) { e.preventDefault(); next.focus(); }
  });

  document.addEventListener('input', (e) => {
    const box = e.target.closest && e.target.closest('.tabmodal-filter');
    if (!box) return;
    const q = box.value.trim().toLowerCase();
    const tm = box.closest('.tabmodal');
    tm.querySelectorAll('.tabmodal-tab').forEach((t) => {
      t.hidden = !!q && !(t.dataset.label || '').toLowerCase().includes(q);
    });
    tm.querySelectorAll('.tabmodal-group').forEach((g) => {
      g.hidden = ![...g.querySelectorAll('.tabmodal-tab')].some((t) => !t.hidden);
    });
  });

  // A link to a place: #settings/<tab> opens the modal on that tab, from any page.
  // The tab you are on may be far down a long list: bring it into view when the modal opens.
  document.body.addEventListener('htmx:after:swap', (e) => {
    const t = e.target && e.target.id === 'editor-modal-body' && e.target.querySelector('.tabmodal-tab.is-selected');
    if (t) t.scrollIntoView({ block: 'nearest' });
  });

  const openFromHash = () => {
    const m = location.hash.match(/^#(settings)\/([^/]+)$/);
    if (m && window.htmx) {
      window.htmx.ajax('GET', `/fragments/settings/modal?tab=${m[2]}`, { target: '#editor-modal-body', swap: 'innerHTML' });
    }
  };
  window.addEventListener('hashchange', openFromHash);
  window.addEventListener('load', openFromHash);
  document.addEventListener('hidden', (e) => {
    if (e.target && e.target.id === 'editor-modal' && /^#settings\//.test(location.hash)) {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* nothing to clear */ }
    }
  }, true);
})();

// The Jira workitem list: typing narrows the cards already on screen at once, by key, title, status,
// type and person, while the debounced request asks Jira for the wider answer. The server's list then
// replaces the cards, so nothing the page did not have is ever hidden by this.
document.addEventListener('input', (e) => {
  const box = e.target.closest && e.target.closest('input[data-jira-find]');
  if (!box) return;
  const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
  const host = document.getElementById('jira-results');
  if (!host) return;
  const cards = [...host.querySelectorAll('.jira-card')];
  let shown = 0;
  cards.forEach((c) => {
    const hay = c.dataset.find || '';
    const on = words.every((w) => hay.includes(w));
    c.hidden = !on;
    if (on) shown += 1;
  });
  let note = host.querySelector('.jira-find-note');
  if (!note) {
    note = document.createElement('p');
    note.className = 'jira-find-note uk-text-meta';
    host.prepend(note);
  }
  note.textContent = words.length && cards.length ? `${shown} of ${cards.length} shown here, asking Jira for more…` : '';
  note.hidden = !note.textContent;
});

// A project's row menus (DDEV, GIT, NODE, COMPOSER, UPSUN and the rest) can hold thirty or seventy entries.
// A long one folds its groups: the first group and "This project" stay open, the rest open on their
// heading; a heading that is a sentence stays a note. Every entry is one line, its full text the tooltip.
function foldDdevMenus(root) {
  (root || document).querySelectorAll('.act-menu .uk-dropdown:not([data-folded])').forEach((drop) => {
    const links = drop.querySelectorAll('li > a').length;
    if (!links) return;           // filled later by its own request, folded then
    drop.dataset.folded = '1';
    drop.querySelectorAll('li > a').forEach((a) => { if (!a.title) a.title = a.textContent.replace(/\s+/g, ' ').trim(); });
    const rows = drop.querySelectorAll('li:not(.uk-nav-divider)').length;
    if (links < 8 && rows < 12) return;
    const heads = [...drop.querySelectorAll('.uk-dropdown-nav > .uk-nav-header')].filter((h) => h.textContent.trim().length <= 40);
    let folds = 0;
    heads.forEach((h) => {
      const rows = [];
      // A group ends at the next heading or divider; a short one is not worth a fold.
      for (let n = h.nextElementSibling; n && !n.classList.contains('uk-nav-header') && !n.classList.contains('uk-nav-divider'); n = n.nextElementSibling) rows.push(n);
      if (rows.length < 3) return;
      const open = (folds === 0 && rows.length <= 6) || /this project/i.test(h.textContent);
      folds += 1;
      h.setAttribute('role', 'button');
      h.tabIndex = 0;
      h.classList.add('ddev-fold');
      const set = (on) => { h.setAttribute('aria-expanded', on ? 'true' : 'false'); rows.forEach((r) => { r.hidden = !on; }); };
      set(open);
      h.addEventListener('click', (e) => { e.stopPropagation(); set(h.getAttribute('aria-expanded') !== 'true'); });
      h.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); h.click(); } });
    });
  });
}
document.addEventListener('DOMContentLoaded', () => foldDdevMenus());
document.body.addEventListener('htmx:after:swap', (e) => foldDdevMenus(swappedEl(e)));
// A menu that opens upwards near the top would sit under the top bar; the page moves down to show it.
document.addEventListener('shown', (e) => {
  const d = e.target;
  if (!d || !d.classList || !d.classList.contains('uk-dropdown') || !d.closest('.project-row')) return;
  foldDdevMenus(d.closest('.act-menu') || d.parentElement);
  const bar = document.querySelector('.toolbar, header');
  const limit = (bar ? bar.getBoundingClientRect().bottom : 64) + 8;
  const top = d.getBoundingClientRect().top;
  if (top < limit) window.scrollBy({ top: top - limit, behavior: 'instant' });
}, true);

// A list's search box sits inside the region its own results replace, so every search threw the box
// away: focus fell to the page and whatever was typed while the request ran was lost. The field being
// typed in is remembered before a swap and given back after it, with its value and caret; if more was
// typed than was searched, the search runs again.
(function keepTypingThroughSwaps() {
  let kept = null;
  document.body.addEventListener('htmx:before:swap', (e) => {
    const a = document.activeElement;
    const ctx = (e.detail && e.detail.ctx) || {};
    const target = ctx.target || (e.detail && e.detail.target) || e.target;
    const into = target && target.nodeType === 1 ? target : null;
    if (!a || !into || !into.contains(a) || !a.matches('input[name], textarea[name]')) { kept = null; return; }
    kept = { name: a.name, value: a.value, start: a.selectionStart, end: a.selectionEnd, target: into };
  });
  document.body.addEventListener('htmx:after:swap', () => {
    if (!kept) return;
    const k = kept; kept = null;
    const field = k.target.querySelector(`[name="${CSS.escape(k.name)}"]`);
    if (!field) return;
    const searched = field.value;
    if (field.value !== k.value) field.value = k.value;
    field.focus({ preventScroll: true });
    try { field.setSelectionRange(k.start, k.end); } catch (_) { /* not a text field */ }
    if (searched !== k.value) field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
  });
})();

// A settings file: find a key, see a switch say what it is, and know when there is something unsaved.
document.addEventListener('input', (e) => {
  const box = e.target.closest && e.target.closest('.settings-find');
  if (!box) return;
  const card = box.closest('.settings-card');
  const words = box.value.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  card.querySelectorAll('.settings-form .settings-row').forEach((row) => {
    const on = words.every((w) => row.textContent.toLowerCase().includes(w));
    row.hidden = !on;
    if (on) shown += 1;
  });
  card.querySelectorAll('.settings-form .settings-group').forEach((g) => {
    g.hidden = !!words.length && ![...g.querySelectorAll('.settings-row')].some((r) => !r.hidden);
  });
  const none = card.querySelector('.settings-find-none');
  if (none) none.hidden = shown > 0 || !words.length;
});
document.addEventListener('change', (e) => {
  const sw = e.target.closest && e.target.closest('.settings-switch');
  if (sw) { const st = sw.parentElement.querySelector('.settings-switch-state'); if (st) st.textContent = sw.checked ? 'On' : 'Off'; }
});
['input', 'change'].forEach((t) => document.addEventListener(t, (e) => {
  const form = e.target.closest && e.target.closest('.settings-form');
  // The list editor writes as it goes, so its fields are never unsaved settings.
  if (!form || e.target.closest('.settings-find, [id^="list-editor"]')) return;
  form.dataset.dirty = '1';
  const d = form.querySelector('.settings-dirty');
  if (d) d.hidden = false;
}));
document.body.addEventListener('htmx:after:request', (e) => {
  const form = e.target && e.target.closest && e.target.closest('.settings-form');
  if (!form || e.target.closest('[id^="list-editor"]')) return;
  const ok = e.detail && e.detail.ctx && e.detail.ctx.response ? e.detail.ctx.response.status < 400 : true;
  if (ok) { delete form.dataset.dirty; const d = form.querySelector('.settings-dirty'); if (d) d.hidden = true; }
});
window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('.settings-form[data-dirty]')) { e.preventDefault(); e.returnValue = ''; }
});

// The guide: search keeps the sections that hold every word and marks the hits; the contents follow
// the section you are reading.
(function helpPage() {
  const page = document.querySelector('.help-layout');
  if (!page) return;
  const sections = [...page.querySelectorAll('.help-section')];
  const clearMarks = () => page.querySelectorAll('mark.help-hit').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
  const mark = (root, word) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const i = n.nodeValue.toLowerCase().indexOf(word);
      if (i >= 0 && !n.parentElement.closest('pre, code, mark')) hits.push([n, i]);
    }
    hits.forEach(([n, i]) => {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length);
      const m = document.createElement('mark'); m.className = 'help-hit'; r.surroundContents(m);
    });
  };
  page.querySelector('.help-find').addEventListener('input', (e) => {
    clearMarks();
    page.querySelectorAll('.help-section').forEach((s) => s.normalize());
    const words = e.target.value.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    let shown = 0;
    sections.forEach((s) => {
      const on = words.every((w) => s.textContent.toLowerCase().includes(w));
      s.hidden = !on;
      const link = page.querySelector(`[data-help-toc="${CSS.escape(s.dataset.helpSection)}"]`);
      if (link) link.parentElement.hidden = !on;
      if (on) { shown += 1; if (words.length) words.forEach((w) => mark(s, w)); }
    });
    page.querySelector('.help-none').hidden = shown > 0;
  });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.filter((x) => x.isIntersecting).forEach((x) => {
        page.querySelectorAll('[data-help-toc]').forEach((a) => a.classList.toggle('is-current', a.dataset.helpToc === x.target.dataset.helpSection));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach((s) => io.observe(s));
  }
})();

// Help for the page you are on: a "?" beside the page heading opens the guide at the part about it.
(function pageHelpLink() {
  const where = document.documentElement.dataset.help;
  const head = document.querySelector('.page-heading');
  if (!where || !head || head.querySelector('.page-help')) return;
  const a = document.createElement('a');
  a.className = 'page-help';
  a.href = `/help#${where}`;
  a.title = 'How this page works, in the guide';
  a.setAttribute('aria-label', 'Help for this page');
  a.textContent = '?';
  head.appendChild(a);
})();

// The guide's code blocks are what people come to copy, so each one has a Copy button.
document.querySelectorAll('.help-body pre').forEach((pre) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'help-copy';
  b.textContent = 'Copy';
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pre.innerText.replace(/\nCopy$/, '')); b.textContent = 'Copied'; }
    catch (_) { b.textContent = 'Select and copy'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  });
  pre.classList.add('has-copy');
  pre.appendChild(b);
});

// Starting a new conversation redraws the panel: deep-chat holds the transcript it was given, and
// emptying it is not something the component exposes — the page it is on is what carries it.
document.body.addEventListener('chat-cleared', () => { window.location.reload(); });

/* ---------------- how much room a page's content gets ------------------- */

// The pages were capped at UIKit's small container whatever room they had, which was right when the
// assistant was a fixed column and the rail was another: 900px was what was left. Neither is fixed any
// more, so the cap is a choice — and it is the content that most wants the width (a command catalog, a
// settings file, a terminal) that was capped hardest.
//
// Applied by the pre-paint script, like the assistant's view: this is the width of the main column, and
// changing it after the page is drawn moves everything on it.
document.addEventListener('click', (e) => {
  const pick = e.target.closest('.page-width-pick');
  if (!pick) return;
  e.preventDefault();
  const width = pick.dataset.width;
  if (!['comfortable', 'wide', 'full'].includes(width)) return;
  document.documentElement.dataset.pageWidth = width;
  wsPrefSet('ws-page-width', width);
  markCurrentViews();
});

// Comfortable or compact project rows. The same buttons; compact folds the caption under each one away, and
// shows it on hover instead. Applied before first paint, like the width.
document.addEventListener('click', (e) => {
  const pick = e.target.closest('.density-pick');
  if (!pick) return;
  e.preventDefault();
  const density = pick.dataset.density === 'compact' ? 'compact' : 'comfortable';
  document.documentElement.dataset.density = density;
  wsPrefSet('ws-density', density);
  markCurrentViews();
});

document.addEventListener('click', (e) => {
  const pick = e.target.closest('.tool-labels-pick');
  if (!pick) return;
  e.preventDefault();
  const mode = pick.dataset.toolLabels === 'words' ? 'words' : 'icons';
  document.documentElement.dataset.toolLabels = mode;
  wsPrefSet('ws-tool-labels', mode);
  markCurrentViews();
});

// The caption of a button is also its tooltip, so folding it away loses nothing for a pointer.
function syncRowCaptions(root) {
  for (const wrap of (root || document).querySelectorAll('.act-with-status')) {
    const cap = wrap.querySelector('.act-status');
    const btn = wrap.querySelector('button');
    if (!cap || !btn) continue;
    const text = cap.textContent.trim();
    if (text && !(btn.title || '').includes(text)) btn.title = btn.title ? `${btn.title} · ${text}` : text;
  }
}
document.addEventListener('DOMContentLoaded', () => syncRowCaptions());
document.body.addEventListener('htmx:after:swap', (e) => syncRowCaptions(swappedEl(e)));

// The tab says when a session has stopped to ask something, so it is visible from any other tab (Vercel does
// the same for a build). Only "waiting" goes in the title: a count of detached sessions would be noise, and the
// page's own title is kept as it was.
const BASE_TITLE = document.title;
function syncTitleState() {
  const w = document.querySelector('.screens-count .screens-waiting');
  if (!w) { document.title = BASE_TITLE; return; }
  const n = parseInt(w.textContent.replace(/[^0-9]/g, ''), 10) || 1;
  document.title = `✋ ${n} waiting · ${BASE_TITLE}`;
}
document.body.addEventListener('htmx:after:swap', (e) => {
  const t = swappedEl(e);
  if (t && t.classList && (t.classList.contains('screens-count') || (t.closest && t.closest('.screens-count')))) syncTitleState();
});
// Watching the badge itself is sturdier than waiting for htmx's own event: it does not matter who rewrote it.
const screensCountEl = document.querySelector('.screens-count');
if (screensCountEl) new MutationObserver(syncTitleState).observe(screensCountEl, { childList: true, subtree: true, characterData: true });
// The first count usually arrives before this script has run, so look once now.
syncTitleState();

/* ---------------- the rail, arranged --------------------------------------- */

// Each entry in Commands → Rail posts "<group>:<id>", and dragging it moves the element without
// touching that value — so a save said every entry was still where it was rendered, and hiding
// something did nothing at all. Every form that sends the arrangement calls this first, from its own
// hx-on::before:request: the value is rewritten from the list the entry is IN at that moment.
window.navSyncGroups = function navSyncGroups() {
  const form = document.getElementById('nav-form');
  if (!form) return;
  for (const entry of form.querySelectorAll('.nav-entry')) {
    const list = entry.closest('[data-group]');
    const input = entry.querySelector('input[name="item"]');
    if (list && input) input.value = `${list.dataset.group}:${entry.dataset.id}`;
  }
};

// Run it on every drop rather than when the form is sent: htmx collects a form's values when the
// request is TRIGGERED, before htmx:before:request fires, so rewriting them there is already too late
// — the save kept arriving with every entry still in the group it was rendered in. UIkit's sortable
// says when something moved; that is the moment the values are stale.
for (const ev of ['moved', 'added', 'removed', 'stop']) {
  document.addEventListener(ev, (e) => {
    if (e.target && e.target.closest && e.target.closest('#nav-form')) window.navSyncGroups();
  }, true);
}

/* ---------------- grid or list -------------------------------------------- */

// Which layout the workspace cards and the project rows use. The state is on <html> and applied by the
// pre-paint script; this only changes it, marks the chosen button, and remembers the choice through the
// shared cookie so it is the same layout on every workspace.
const VIEW_PREFS = {
  'ws-home-view': { attr: 'homeView', allowed: ['list', 'grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-5', 'grid-6'] },
  'ws-rows-view': { attr: 'rowsView', allowed: ['list', 'grid-1', 'grid-2', 'grid-3'] },
  // A folder of files: a list of names, or a grid of up to six across for a folder of pictures.
  'ws-files-view': { attr: 'filesView', allowed: ['list', 'grid-1', 'grid-2', 'grid-3', 'grid-4', 'grid-5', 'grid-6'] },
};

function markCurrentViews() {
  for (const btn of document.querySelectorAll('.view-pick')) {
    const spec = VIEW_PREFS[btn.dataset.pref];
    if (!spec) continue;
    const current = document.documentElement.dataset[spec.attr] === btn.dataset.view;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
  for (const btn of document.querySelectorAll('.density-pick')) {
    const current = document.documentElement.dataset.density === btn.dataset.density;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
  // Words or icons: the browser's own choice, else what the style says (its --pcard-tool-label).
  const styleSays = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pcard-tool-label')) || 0) > 0 ? 'words' : 'icons';
  for (const btn of document.querySelectorAll('.tool-labels-pick')) {
    const current = (document.documentElement.dataset.toolLabels || styleSays) === btn.dataset.toolLabels;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
  // The page width sits in the same group and is marked the same way.
  for (const btn of document.querySelectorAll('.page-width-pick')) {
    const current = document.documentElement.dataset.pageWidth === btn.dataset.width;
    btn.classList.toggle('is-current', current);
    btn.setAttribute('aria-pressed', current ? 'true' : 'false');
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.view-pick');
  if (!btn) return;
  e.preventDefault();
  const spec = VIEW_PREFS[btn.dataset.pref];
  if (!spec || !spec.allowed.includes(btn.dataset.view)) return;
  document.documentElement.dataset[spec.attr] = btn.dataset.view;
  wsPrefSet(btn.dataset.pref, btn.dataset.view);
  markCurrentViews();
});

// The rows and the cards arrive in fragments, so the marking is redone after every swap.
markCurrentViews();
document.addEventListener('htmx:after:settle', markCurrentViews);

/* ---------------- how the assistant is shown ---------------------------- */

// Four views, one switch, after the pattern Drupal's own AI assistant uses: a toggle in the top
// toolbar, and a menu in the panel's header holding the rest. Sidebar is the column it has always
// been, Wide is that column doubled for a long answer, Floating is a launcher with the panel over
// the page, and Full page is /assistant.
//
// The state lives on <html> (data-assistant-view, .assistant-closed) and is applied by the
// pre-paint script in the head, not from here: the panel is 25rem of the layout, so deciding it in
// this deferred file would draw the page one way and reflow it a frame later. This file only
// CHANGES it. localStorage, like the theme and the rail — and with the same known limit, that it
// does not cross the workspace subdomains.
const ASSISTANT_VIEWS = ['sidebar', 'wide', 'float', 'full'];

function assistantView() {
  const v = document.documentElement.dataset.assistantView;
  return ASSISTANT_VIEWS.includes(v) ? v : 'sidebar';
}

function setAssistantView(view) {
  if (!ASSISTANT_VIEWS.includes(view)) return;
  // Full page is a place, not a layout: switching to it goes there, and the panel on the page you
  // came from would be a second copy of the same conversation.
  if (view === 'full') {
    wsPrefSet('ws-assistant-view', view);
    window.location.href = '/assistant';
    return;
  }
  document.documentElement.dataset.assistantView = view;
  setAssistantOpen(true);
  document.dispatchEvent(new CustomEvent('assistant-view-changed'));
  wsPrefSet('ws-assistant-view', view);
  // Leaving the full-page view has to leave the page too: /assistant has no panel to become a
  // sidebar. Back where you came from, or home when that was somewhere else.
  if (window.location.pathname === '/assistant') {
    const from = document.referrer && new URL(document.referrer, window.location.origin);
    window.location.href = from && from.origin === window.location.origin && from.pathname !== '/assistant'
      ? from.href : '/';
  }
}

function setAssistantOpen(open) {
  document.documentElement.classList.toggle('assistant-closed', !open);
  const row = document.querySelector('.actions-assistant');
  if (row) row.setAttribute('aria-expanded', open ? 'true' : 'false');
  wsPrefSet('ws-assistant-open', open ? '1' : '0');
}

document.addEventListener('click', (e) => {
  // Show it. In the full-page view there is no panel to show — the assistant IS a page there — so this
  // is the way to it; on that page it is already in front of you and there is nothing to do.
  if (e.target.closest('.assistant-open-pick')) {
    e.preventDefault();
    if (window.location.pathname === '/assistant') return;
    if (assistantView() === 'full') { window.location.href = '/assistant'; return; }
    setAssistantOpen(true);
    return;
  }
  // Wider, and back again — one button, because it is one question: how much room does this answer
  // need? Floating has its own size, so there it is the sidebar it widens back into.
  if (e.target.closest('.assistant-wider')) {
    e.preventDefault();
    setAssistantView(assistantView() === 'wide' ? 'sidebar' : 'wide');
    return;
  }
  const pick = e.target.closest('.assistant-view-pick');
  if (pick) { e.preventDefault(); setAssistantView(pick.dataset.view); return; }
  if (e.target.closest('.assistant-hide, .assistant-close-pick')) { e.preventDefault(); setAssistantOpen(false); return; }
  // The launcher in the corner: the way back in, in every view. In the full-page view there is no
  // panel to show, so it leads to the page instead.
  if (e.target.closest('.assistant-launcher')) {
    e.preventDefault();
    if (assistantView() === 'full') { window.location.href = '/assistant'; return; }
    setAssistantOpen(true);
  }
}, true);

document.addEventListener('click', (e) => {
  // A pick closes the menu it was made in — a dropdown left open over the panel it just changed reads
  // as a control that did not take.
  if (e.target.closest('.assistant-dropdown a') && window.UIkit) {
    const dd = e.target.closest('.uk-dropdown');
    if (dd) window.UIkit.dropdown(dd).hide(false);
  }
});

// Floating means floating: the panel can be dragged anywhere on the screen, because where it should sit
// depends on what is under it — a project table, a form, a terminal — and that changes page by page.
//
// The header is the handle (a window's title bar is), minus its buttons: a drag that started on the
// close button would close the panel on release. The position is per browser, clamped into the viewport
// on every apply, so a panel dragged to the edge of a wide screen is still reachable on a narrow one.
(function draggableAssistant() {
  const KEY = 'ws-assistant-pos';
  const panel = () => document.querySelector('.assistant-side');

  const clamp = (x, y, el) => {
    const r = el.getBoundingClientRect();
    // A strip of the panel always has to stay on screen, and the header has to stay reachable.
    const maxX = Math.max(0, window.innerWidth - r.width);
    const maxY = Math.max(0, window.innerHeight - Math.min(r.height, 64));
    return [Math.min(Math.max(0, x), maxX), Math.min(Math.max(0, y), maxY)];
  };

  const place = (x, y) => {
    const el = panel();
    if (!el) return;
    const [cx, cy] = clamp(x, y, el);
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    el.style.bottom = 'auto';
    el.style.right = 'auto';
  };

  const stored = () => {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  };

  function applyStored() {
    const el = panel();
    if (!el) return;
    if (document.documentElement.dataset.assistantView !== 'float') {
      // Every other view is laid out by the stylesheet; leftover inline positions would fight it.
      el.style.left = el.style.top = el.style.bottom = el.style.right = '';
      return;
    }
    const p = stored();
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) place(p.x, p.y);
  }

  document.addEventListener('pointerdown', (e) => {
    if (document.documentElement.dataset.assistantView !== 'float') return;
    const head = e.target.closest('.assistant-side .assistant-head');
    if (!head || e.target.closest('button, a, input, select, .assistant-dropdown')) return;
    const el = panel();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    let moved = false;
    head.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');

    const move = (ev) => { moved = true; place(ev.clientX - dx, ev.clientY - dy); };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      el.classList.remove('is-dragging');
      if (!moved) return;
      const r2 = el.getBoundingClientRect();
      try { localStorage.setItem(KEY, JSON.stringify({ x: Math.round(r2.left), y: Math.round(r2.top) })); } catch (_) { /* ignore */ }
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  // A window that got smaller must not leave the panel off-screen, and a view change re-lays it out.
  window.addEventListener('resize', applyStored);
  document.addEventListener('assistant-view-changed', applyStored);
  applyStored();
})();

/* ---------------- the AI assistant, as a deep-chat component ------------ */

// deep-chat is configured with properties rather than attributes: anything that is not a string
// (the connect object, the style maps, the interceptor) cannot survive an attribute.
(function initDeepChat() {
  const el = document.getElementById('ws-deep-chat');
  if (!el || el.dataset.wsReady) return;
  el.dataset.wsReady = '1';

  const context = el.dataset.context || 'home';
  // What the settings file says about this panel. A missing or unreadable attribute falls back to
  // the same defaults the resolver uses, so the panel still works if the settings never arrive.
  let cfg = { voiceInput: true, submitAfterSilence: 2500, voiceOutput: true, speechRate: 1, placeholder: '' };
  try { cfg = { ...cfg, ...JSON.parse(el.dataset.settings || '{}') }; } catch (_) { /* keep the defaults */ }

  el.connect = {
    url: '/actions/deep-chat',
    method: 'POST',
    additionalBodyProps: { context },
  };

  // The conversation carries across pages. Every page draws a new deep-chat, so the transcript has
  // to be handed back to it: the server keeps the thread (the id is a cookie on the hub domain, the
  // only thing that crosses <workspace>.<hub> subdomains) and returns it in deep-chat's own history
  // shape. Fetched rather than rendered into the page because the panel is built in pageShell, which
  // does not see the request — and it is one small same-origin GET either way.
  //
  // The agent's own memory is the other half, and it is the server's: it resumes the claude session
  // this thread started. A transcript in front of an agent that remembers none of it reads as memory
  // and is not.
  // Suggested prompts: shown only when the saved conversation is empty.
  const suggestions = Array.isArray(cfg.suggestions)
    ? cfg.suggestions.filter((s) => typeof s === 'string' && s.trim()) : [];
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A click fills the composer and never sends (the assistant has a shell).
  const fillComposer = (text) => {
    const input = el.shadowRoot && el.shadowRoot.querySelector('#text-input');
    if (!input) return;
    const existing = (input.innerText || '').trim();
    input.innerText = existing ? `${existing} ${text}` : text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // deep-chat draws inside a shadow root, so the look and the click are attached by class here.
  el.htmlClassUtilities = {
    ...(el.htmlClassUtilities || {}),
    'ws-suggestion': {
      events: { click: (event) => fillComposer((event.currentTarget || event.target).textContent.trim()) },
      styles: {
        default: {
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          margin: '0 0 0.35rem', padding: '0.45rem 0.7rem', borderRadius: '0.6rem',
          border: '1px solid var(--line)', background: 'var(--surface-input)', color: 'var(--text-default)',
          fontFamily: 'var(--font-primary)', fontSize: '0.88rem', lineHeight: '1.4',
        },
        hover: { borderColor: 'var(--brand-primary)', color: 'var(--brand-primary)' },
      },
    },
  };

  // deep-chat-temporary-message: removed when the next message arrives, never saved to the thread.
  let suggestTries = 0;
  let conversationEmpty = true;
  const suggestOn = () => (window.wsPref ? window.wsPref('ws-suggest', null) : null) !== '0';
  const showSuggestions = () => {
    if (!suggestions.length || el.dataset.wsSuggested || !suggestOn()) return;
    el.dataset.wsSuggested = '1';
    const html = `<div class="deep-chat-temporary-message ws-suggestions">${
      suggestions.map((s) => `<button type="button" class="ws-suggestion">${escapeHtml(s)}</button>`).join('')}</div>`;
    try { el.addMessage({ role: 'ai', html }); }
    catch (_) {
      // The component may not be ready yet.
      delete el.dataset.wsSuggested;
      if ((suggestTries += 1) < 8) setTimeout(showSuggestions, 400);
    }
  };

  const hideSuggestions = () => {
    const box = el.shadowRoot && el.shadowRoot.querySelector('.ws-suggestions');
    const outer = box && box.closest('[class*="outer-message-container"]');
    if (outer) outer.remove();
    delete el.dataset.wsSuggested;
  };

  fetch('/fragments/chat/history', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.messages) && data.messages.length) { conversationEmpty = false; el.history = data.messages; }
      else showSuggestions();
    })
    .catch(() => { showSuggestions(); });

  // Voice summary: the checkbox in the assistant options. The choice is kept per browser; settings.yml
  // only sets where it starts.
  // The narration's voice settings, kept by reference: the avatar's settings change its volume live.
  const narrationParams = { ...(cfg.narration || {}) };
  // settings.yml never makes an ElevenLabs voice the default: that spends credits, so it is picked in the avatar's settings.
  if (/^elevenlabs:/i.test(String(narrationParams.voiceName || ''))) delete narrationParams.voiceName;
  // What someone chose in the avatar's settings: volume, speed, pitch and the voice. An empty cookie means
  // not chosen, never 0, which would silence the voice.
  const VOICE_PREFS = { volume: ['ws-voice-volume', 0, 1], rate: ['ws-voice-rate', 0.5, 2], pitch: ['ws-voice-pitch', 0, 2] };
  for (const [key, [name, min, max]] of Object.entries(VOICE_PREFS)) {
    try { const raw = window.wsPref ? window.wsPref(name, '') : ''; const v = Number(raw); if (raw !== '' && raw !== null && Number.isFinite(v) && v >= min && v <= max) narrationParams[key] = v; } catch (_) { /* default */ }
  }
  try { const vn = window.wsPref ? window.wsPref('ws-voice-name', '') : ''; if (vn) narrationParams.voiceName = vn; } catch (_) { /* best free voice */ }
  const narrator = window.wsNarration.createNarrator({
    params: narrationParams,
    defaultOn: cfg.voiceOutput !== false,
    getPref: (name) => (window.wsPref ? window.wsPref(name, null) : null),
    setPref: wsPrefSet,
    synth: window.speechSynthesis,
    Utterance: window.SpeechSynthesisUtterance,
    onSpeech: (detail) => document.dispatchEvent(new CustomEvent('ws-assistant-speech', { detail })),
    // An ElevenLabs voice: the server speaks (its key never comes here) and this plays the audio, at the
    // chosen volume and speed. The words are spread over the clip so the avatar's mouth keeps moving.
    // When the server cannot, the same words are spoken in the browser's voice instead.
    remote: (text, voiceId, params, onSpeech, fallback) => {
      let stopped = false; let audio = null; let url = '';
      const ctl = new AbortController();
      const words = text.split(/\s+/);
      const done = () => { if (url) URL.revokeObjectURL(url); url = ''; if (onSpeech) onSpeech({ type: 'end' }); };
      fetch('/actions/assistant/speak', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: voiceId, text }) })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => {
          if (stopped) return;
          url = URL.createObjectURL(blob);
          audio = new Audio(url);
          audio.volume = Number.isFinite(params.volume) ? params.volume : 1;
          audio.playbackRate = Number.isFinite(params.rate) ? params.rate : 1;
          let said = -1;
          audio.onplay = () => { if (onSpeech) onSpeech({ type: 'start' }); };
          audio.ontimeupdate = () => {
            const i = Math.floor((audio.currentTime / (audio.duration || 1)) * words.length);
            if (i !== said && i < words.length) { said = i; if (onSpeech) onSpeech({ type: 'word', word: words[i] }); }
          };
          audio.onended = done;
          audio.onerror = done;
          return audio.play();
        })
        .catch(() => { if (!stopped) fallback(); });
      return () => { stopped = true; ctl.abort(); if (audio) { audio.pause(); audio.src = ''; } if (url) { URL.revokeObjectURL(url); url = ''; } };
    },
  });
  window.addEventListener('pagehide', narrator.cancel);
  // The assistant's avatar (assistant-avatar-ui.js) mutes and unmutes this voice, and hides it.
  window.wsAssistantVoice = {
    isOn: narrator.isOn, setOn: narrator.setOn, cancel: narrator.cancel, speak: narrator.speak,
    volume: () => (Number.isFinite(narrationParams.volume) ? narrationParams.volume : 1),
    setVolume: (v) => { narrationParams.volume = Math.max(0, Math.min(1, Number(v))); try { wsPrefSet('ws-voice-volume', String(narrationParams.volume)); } catch (_) { /* not kept */ } },
    get: (key) => narrationParams[key],
    set: (key, value) => {
      if (key === 'voiceName') { narrationParams.voiceName = String(value || ''); try { wsPrefSet('ws-voice-name', narrationParams.voiceName); } catch (_) { /* not kept */ } return; }
      if (!VOICE_PREFS[key]) return;
      const [name, min, max] = VOICE_PREFS[key];
      narrationParams[key] = Math.max(min, Math.min(max, Number(value)));
      try { wsPrefSet(name, String(narrationParams[key])); } catch (_) { /* not kept */ }
    },
  };
  el.requestInterceptor = (details) => {
    details.body = { ...details.body, voice: narrator.isOn(), avatar: Boolean(window.wsAssistantAvatarOn && window.wsAssistantAvatarOn()), avatarName: window.wsAvatarName ? window.wsAvatarName() : '', avatarId: window.wsAvatarId ? window.wsAvatarId() : '', page: window.wsAvatarContext ? window.wsAvatarContext() : null };
    return details;
  };
  const playSendAnimation = () => {
    const btn = el.shadowRoot && el.shadowRoot.querySelector('.input-button.inside-end');
    if (!btn) return;
    btn.classList.remove('ws-sent');
    void btn.offsetWidth;
    btn.classList.add('ws-sent');
    setTimeout(() => btn.classList.remove('ws-sent'), 700);
  };
  // Working: from a message being sent until the answer, or an error, comes back.
  let workingTimer = null;
  const setWorking = (on, failed = false) => {
    clearTimeout(workingTimer);
    el.toggleAttribute('data-assistant-working', on);
    document.dispatchEvent(new CustomEvent('ws-assistant-working', { detail: { on, failed } }));
    document.querySelectorAll('.assistant-panel').forEach((p) => p.toggleAttribute('data-working', on));
    if (on) workingTimer = setTimeout(() => setWorking(false), 16 * 60 * 1000);
  };
  el.onMessage = ({ message, isHistory }) => {
    if (isHistory || !message) return;
    if (message.role === 'user') { conversationEmpty = false; narrator.cancel(); playSendAnimation(); setWorking(true); }
    else setWorking(false);
  };
  el.onError = () => setWorking(false, true);

  // The reply arrives as rendered markdown plus the directives the assistant ended with. Acting on
  // them here keeps the interface steering that the HTMX pane had: the agent can start a project
  // and then take you to it.
  el.responseInterceptor = (response) => {
    const d = response && response.directive;
    if (d) {
      if (d.refresh) document.body.dispatchEvent(new CustomEvent('refresh-projects'));
      if (d.open) window.open(d.open, '_blank', 'noopener');
      if (d.navigate) setTimeout(() => { window.location.href = d.navigate; }, 600);
    }
    setWorking(false);
    if (response && response.html) narrator.narrate({ spoken: d && d.spoken, html: response.html });
    document.dispatchEvent(new CustomEvent('ws-assistant-reply', { detail: { directive: d || null, voice: narrator.isOn() } }));
    return response;
  };

  // Voice in and out, exactly as speech.js resolved them.
  //
  // The page does not build these objects any more. Which keys may be absent is the substance of
  // that config — an empty `commands` phrase arms a command rather than disabling one, and
  // `substrings` defaults to true so "submit the form" would fire mid-sentence — and those rules
  // belong somewhere a test can require, not in a browser file that can only be checked by reading
  // it. `false` here means the microphone is removed rather than left as a button that does nothing.
  if (cfg.speechToText !== undefined) el.speechToText = cfg.speechToText;
  el.textToSpeech = false;   // narration is the voice summary above; deep-chat's own never speaks an HTML reply

  // The prompt is the main control of this panel, so it is sized like one rather than like a
  // single-line search box: room for a few lines of a real instruction before it scrolls.
  el.textInput = {
    // Whatever `assistant: placeholder:` says, and by default nothing visible: an empty field with
    // a cursor in it already says "type here", and a prompt that suggests what to ask narrows what
    // gets asked.
    //
    // "Nothing" cannot be spelled as an empty string. deep-chat reads this as
    // `placeholder.text || "Ask me anything!"`, so a blank does not remove its placeholder, it
    // restores deep-chat's — which is how "Ask me anything!" was showing on a panel configured to
    // say nothing. The text it IS given becomes the composer's aria-label as well, so with nothing
    // to display this carries the accessible name a textbox needs and `hidePlaceholder` below
    // blanks what is drawn. Configure one and it is both the visible text and the name.
    placeholder: { text: cfg.placeholder || `Message the ${cfg.name || 'AI Assistant'}` },
    styles: {
      container: {
        minHeight: '4.5rem',
        maxHeight: '11rem',
        borderRadius: '0.85rem',
        padding: '0.65rem 0.9rem',
        boxShadow: '0 1px 2px rgba(0,0,0,.06)',
        // Tokens, not values. deep-chat writes these as inline styles inside its shadow root,
        // and a custom property inherits THROUGH a shadow boundary from the host — so var()
        // here resolves against :root and follows the theme, both halves, with no second copy
        // of this object for dark and no re-render when the toggle is pressed.
        backgroundColor: 'var(--surface-input)',
        border: '1px solid var(--line)',
        color: 'var(--text-default)',
      },
      text: { fontSize: '1rem', lineHeight: '1.45', fontFamily: 'var(--font-primary)' },
    },
  };

  // deep-chat's own send and microphone are role="button" with an SVG inside and no accessible name,
  // so a screen reader announces two unnamed buttons at the end of the composer — axe's
  // aria-command-name, on every page the panel is on. They live in the component's shadow root, which
  // is reachable but not ours to edit, so the names are set from here rather than by forking the
  // vendored bundle.
  const nameChatButtons = () => {
    const root = el.shadowRoot;
    if (!root) return;
    const names = [
      ['#microphone-button', 'Dictate the message'],
      ['.input-button.inside-end', 'Send the message'],
      ['#submit-icon', 'Send the message'],
    ];
    for (const [sel, label] of names) {
      for (const node of root.querySelectorAll(sel)) {
        if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', label);
      }
    }
  };
  // The two things deep-chat insists on drawing, turned off from inside its shadow root.
  //
  // Both are there because the component treats "nothing" as "not configured" and substitutes its
  // own: an empty `placeholder.text` restores "Ask me anything!", and an unset `introMessage`
  // restores the library placeholder about connect and the demo property. So both are SET, to the
  // emptiest thing that still suppresses the default, and what is left to draw is hidden here.
  //
  //   - The placeholder is `content: attr(deep-chat-placeholder-text)` on the empty input, coloured
  //     by a rule of deep-chat's own, so neither an empty string nor a colour on the input turns it
  //     off. Blanking that one pseudo-element does, and it leaves the attribute — and the aria-label
  //     built from it — in place: silent on screen, named to a screen reader. A configured
  //     placeholder skips this and is drawn normally.
  //   - The intro message is an empty <span>, and an empty span in a message bubble is still a
  //     bubble: a small blank pill at the top of every transcript, which reads as a message that
  //     failed to load.
  const chatChrome = () => {
    const root = el.shadowRoot;
    if (!root || root.getElementById('ws-chat-chrome')) return;
    const st = document.createElement('style');
    st.id = 'ws-chat-chrome';
    st.textContent = '.deep-chat-intro { display: none !important; }'
      + (cfg.placeholder ? '' : '\n#text-input:empty::before { content: "" !important; }')
      + '\n:host([data-assistant-mic="off"]) #microphone-button { display: none !important; }';
    root.appendChild(st);
  };
  // Watched, not timed: the component builds and rebuilds those buttons whenever the composer changes,
  // so a handful of setTimeouts named them on one page load and missed them on the next.
  nameChatButtons();
  chatChrome();
  if (el.shadowRoot && window.MutationObserver) {
    new MutationObserver(() => { nameChatButtons(); chatChrome(); })
      .observe(el.shadowRoot, { childList: true, subtree: true });
  } else {
    setTimeout(() => { nameChatButtons(); chatChrome(); }, 500);
  }

  // No opening message, and none of deep-chat's own either. Left unset, the component renders its
  // library placeholder — the one about connect, directConnection and the demo property — which is
  // documentation for whoever is building a chat, not for whoever is using this one. An empty
  // introMessage is what keeps that out without putting anything of ours in its place; the bubble
  // it still draws around that emptiness is hidden by `chatChrome` above.
  el.introMessage = { html: '<span></span>' };


  // A build is minutes of work, so the component must not give up on the request.
  //
  // The look, in the Webship design system rather than deep-chat's stock preset: the user's turn
  // carries the same brand gradient as the rest of the interface, and the assistant's sits on a
  // plain card surface so long technical replies stay readable. Every colour here is a token —
  // the component shipped a fixed purple gradient and a fixed near-white bubble, which meant the
  // panel was a different product from the page around it and stayed light after dark.
  el.messageStyles = {
    default: {
      shared: {
        bubble: {
          maxWidth: '92%',
          borderRadius: '0.85rem',
          padding: '0.6rem 0.85rem',
          marginTop: '0.35rem',
          marginBottom: '0.35rem',
          fontSize: '0.95rem',
          lineHeight: '1.5',
          fontFamily: 'var(--font-primary)',
        },
      },
      user: {
        bubble: {
          background: 'var(--brand-grad)',
          color: 'var(--text-inverse)',
        },
      },
      ai: {
        bubble: { backgroundColor: 'var(--surface-muted)', color: 'var(--text-default)' },
      },
    },
    // Since 2.1.0 the loading bubble is styled through its own shape, not a plain bubble object.
    loading: { message: { styles: { bubble: { backgroundColor: 'var(--surface-muted)' } } } },
    error: { bubble: { backgroundColor: 'var(--danger-soft)', color: 'var(--danger-ink)', fontSize: '0.9rem' } },
  };

  // Injected into the component's shadow root, which is the only way to reach what deep-chat
  // renders inside itself: the typeface, and the typography of the markdown we return.
  //
  // deep-chat's own default is Inter. The dashboard is Figtree, per the brand tokens, so the
  // one panel a person actually reads sentences in was the one panel not in the brand face. The
  // wildcard is deliberate: the component builds its own buttons, toolbar and placeholder, and
  // none of them inherit from the page across the shadow boundary.
  el.auxiliaryStyle = `
    * { font-family: var(--font-primary); }
    /* deep-chat's own chrome, which its style properties do not reach: the panel it draws behind
       the transcript, the input shell, the two round buttons and the tooltip. Left alone they are
       a white panel and a lilac microphone — the component's brand, not ours, and both stayed
       light after dark. */
    #chat-view, #input { background-color: transparent !important; }
    #text-input-container { background-color: var(--surface-input) !important; border: 1px solid var(--line) !important; }
    #text-input { color: var(--text-default) !important; }
    #text-input[textinputplaceholderstyle] { color: var(--text-subtle) !important; }
    .input-button-svg { background-color: var(--surface-muted) !important; }
    #microphone-button { background: var(--brand-grad) !important; }
    #microphone-button.active { background: var(--danger) !important; }
    .tooltip { background-color: var(--code-bg) !important; color: var(--code-ink) !important; }
    .dc-reply p { margin: 0 0 .5rem; }
    .dc-reply p:last-child { margin-bottom: 0; }
    .dc-reply pre { background: var(--code-bg); color: var(--code-ink); padding: .5rem .65rem; border-radius: .5rem; overflow-x: auto; }
    .dc-reply code, .dc-reply pre, .dc-reply pre * { font-family: var(--font-code); font-size: .88em; }
    .dc-reply a { color: var(--link); }
    .dc-reply table { border-collapse: collapse; width: 100%; font-size: .9em; }
    .dc-reply th, .dc-reply td { border: 1px solid var(--line); padding: .3rem .45rem; text-align: left; }
    .input-button.inside-end { transition: transform .08s; }
    .input-button.inside-end:active { transform: scale(.92); }
    .input-button.inside-end.ws-sent svg { animation: ws-send-fly .6s cubic-bezier(.4, 0, .2, 1); }
    @keyframes ws-send-fly {
      0%   { translate: 0 0; scale: 1; opacity: 1; }
      40%  { translate: 10px -10px; scale: .8; opacity: 0; }
      41%  { translate: -10px 10px; scale: .8; opacity: 0; }
      100% { translate: 0 0; scale: 1; opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .input-button.inside-end.ws-sent svg { animation: none; } }
    .input-button.inside-end svg { transition: opacity .15s; }
    :host([data-assistant-working]) .input-button.inside-end { position: relative !important; }
    :host([data-assistant-working]) .input-button.inside-end.disabled-button { opacity: 1; }
    :host([data-assistant-working]) .input-button.inside-end svg { opacity: 0; }
    :host([data-assistant-working]) .loading-submit-button { display: none !important; }
    :host([data-assistant-working]) .input-button.inside-end::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background-image: radial-gradient(circle, var(--text-inverse) 2.4px, transparent 2.9px), radial-gradient(circle, var(--text-inverse) 2.4px, transparent 2.9px), radial-gradient(circle, var(--text-inverse) 2.4px, transparent 2.9px);
      background-size: 8px 8px; background-repeat: no-repeat;
      background-position: calc(50% - 9px) 55%, 50% 55%, calc(50% + 9px) 55%;
      animation: ws-dots 1.2s ease-in-out infinite;
    }
    @keyframes ws-dots {
      0%, 60%, 100% { background-position: calc(50% - 9px) 55%, 50% 55%, calc(50% + 9px) 55%; }
      15% { background-position: calc(50% - 9px) 30%, 50% 55%, calc(50% + 9px) 55%; }
      30% { background-position: calc(50% - 9px) 55%, 50% 30%, calc(50% + 9px) 55%; }
      45% { background-position: calc(50% - 9px) 55%, 50% 55%, calc(50% + 9px) 30%; }
    }
    @media (prefers-reduced-motion: reduce) { :host([data-assistant-working]) .input-button.inside-end::after { animation: none; } }
  `;

  el.requestBodyLimits = { maxMessages: 1 };

  // Prompt mode lives in deep-chat's own input toolbar, beside the send button, the way
  // ai_agent_modes puts its compact selector in the message box toolbar. deep-chat builds that
  // toolbar itself, so the select is rendered in the page and moved in once it exists.
  const picker = document.querySelector('.chat-tools .command-picker');

  // The check buttons in the assistant options. Each is kept per browser; the settings only say where it starts.
  const savedSwitch = (name, start) => {
    const v = window.wsPref ? window.wsPref(name, null) : null;
    return v === null || v === undefined ? start : v === '1';
  };
  const prefSwitch = (name, start, apply) => ({
    get: () => savedSwitch(name, start),
    set: (on) => { wsPrefSet(name, on ? '1' : '0'); apply(on); },
    init: () => apply(savedSwitch(name, start)),
  });
  const switches = {
    voice: {
      show: narrator.supported, get: narrator.isOn,
      set: (on) => { narrator.setOn(on); if (on) narrator.speak('Voice summary on.'); },
    },
    mic: {
      show: cfg.speechToText !== false,
      ...prefSwitch('ws-mic', cfg.voiceInput !== false, (on) => (on ? el.removeAttribute('data-assistant-mic') : el.setAttribute('data-assistant-mic', 'off'))),
    },
    mode: {
      show: !!picker,
      ...prefSwitch('ws-mode', true, (on) => { if (picker) picker.style.display = on ? '' : 'none'; }),
    },
    suggest: {
      show: suggestions.length > 0,
      ...prefSwitch('ws-suggest', true, (on) => { if (on) { if (conversationEmpty) showSuggestions(); } else hideSuggestions(); }),
      init: null,   // showSuggestions already reads the saved choice once the history has loaded
    },
  };
  document.querySelectorAll('.assistant-switch').forEach((box) => {
    const sw = switches[box.dataset.switch];
    if (!sw || !sw.show) { box.closest('li').hidden = true; return; }
    box.checked = sw.get();
    if (sw.init) sw.init();
    box.addEventListener('change', () => {
      sw.set(box.checked);
      document.querySelectorAll(`.assistant-switch[data-switch="${box.dataset.switch}"]`).forEach((b) => { b.checked = box.checked; });
    });
  });
  if (picker) {
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      const [workspace, file] = picker.value.split('/');
      const input = el.shadowRoot && el.shadowRoot.querySelector('#text-input');
      picker.value = '';
      if (!input) return;
      const existing = (input.innerText || '').trim();
      const phrase = `Run ${file} in ${workspace}: `;
      input.innerText = existing ? `${existing} ${phrase}` : phrase;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Styles do not cross a shadow boundary, so the select takes its own with it.
    const shadowCss = `
      /* The prompt is a card: the text on its own line, and a toolbar under it holding the mode
         selector and the send button — the shape ai_agent_modes uses. deep-chat lays its input out
         in one row, so the row is allowed to wrap and the text box is given the whole first line. */
      #input {
        box-sizing: border-box;
        max-width: 100%;
        flex-wrap: wrap;
        align-items: center;
        row-gap: 8px;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 8px 10px;
        background-color: var(--surface-input);
      }
      #text-input-container { flex: 1 1 100%; }
      #text-input {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        padding: 4px 2px !important;
      }
      /* deep-chat anchors its buttons absolutely inside zero-size containers, which floats them
         over the text area. In a toolbar they have to take part in the row, so the containers get
         a size and the buttons stop being positioned. */
      .input-button-container {
        order: 2;
        position: static;
        width: auto;
        height: auto;
        display: flex;
        align-items: center;
      }
      .input-button-container > * { position: static !important; }
      .input-button { position: static !important; margin: 0 !important; }
      /* The icons are laid out by deep-chat with their own offsets — the microphone sat 14px down
         and 2px outside its button. Centring them means clearing that, not just centring the box
         that holds them. */
      .input-button svg {
        position: static !important;
        margin: 0 !important;
        inset: auto !important;
        transform: none !important;
        display: block !important;
        flex: none !important;
      }

      /* The send button is the assistant's own colour, the brand gradient its header and your messages
         carry, in a square sized to the selector beside it so the row reads as one control. Every colour in
         this block is a token: a custom property inherits into the shadow root, so both halves follow the
         theme. It used to be UIKit blue, resting on a fixed pale grey that stayed light after dark. */
      .input-button.inside-end {
        width: 34px;
        height: 34px;
        box-sizing: border-box;
        padding: 0 !important;
        border-radius: 8px;
        background: var(--brand-grad) !important;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* deep-chat tints its icons with an inline filter, so the icon colour has to be forced the
         same way the background was. On the blue square the arrow is white. */
      .input-button.inside-end svg { width: 17px !important; height: 17px !important; filter: brightness(0) invert(1) !important; }
      .input-button.inside-end:hover { filter: brightness(1.08); }
      /* Disabled is the resting state — there is nothing to send until something is typed — so it reads
         as the same button, not yet ready: the gradient at half strength, the arrow still white. */
      .input-button.inside-end.disabled-button { opacity: .5; }
      .input-button.inside-end.disabled-button:hover { filter: none; }

      /* The microphone is a button too, so it gets the same square as the send button rather than
         sitting next to it as a bare icon. */
      .input-button.outside-end {
        width: 34px;
        height: 34px;
        box-sizing: border-box;
        padding: 0 !important;
        margin-left: 6px !important;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: var(--brand-grad) !important;
      }
      /* The microphone is a filled icon, so it is coloured rather than filtered — the same ink the
         rest of the interface uses, not deep-chat's green tint. */
      .input-button.outside-end svg { width: 17px !important; height: 17px !important; filter: none !important; }
      .input-button.outside-end svg, .input-button.outside-end svg * { fill: var(--text-inverse) !important; }
      .input-button.outside-end:hover { filter: brightness(1.08); }
      /* While it is listening it is the active control in the row, so it says so. */
      .input-button.outside-end.active-button { background: var(--danger) !important; }

      .command-picker {
        order: 2;
        box-sizing: border-box;
        /* A select is as wide as its longest option unless it is told otherwise — 563px of one
           here, in a 358px sidebar. Zero basis with min-width:0 makes it take the space that is
           left instead of the space it wants. */
        flex: 1 1 0;
        width: 0;
        min-width: 0;
        height: 34px;
        font-size: 14px;
        line-height: 1;
        padding: 0 28px 0 10px;
        margin: 0 8px 0 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        background-color: var(--surface-input);
        color: var(--text-default);
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23555' d='M4 6l4 4 4-4z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
        background-size: 14px;
      }
      .command-picker:focus { outline: none; border-color: var(--link); box-shadow: 0 0 0 2px var(--focus-ring); }
    `;

    // The toolbar is built after the component upgrades, so wait for the send button rather than
    // assuming it is there; give up quietly and leave the select where it is if it never appears.
    let tries = 0;
    const place = () => {
      const sr = el.shadowRoot;
      const submit = sr && sr.querySelector('.input-button.inside-end, .input-button.outside-end');
      if (!submit) {
        // No give-up: deep-chat can take longer than any fixed budget on a busy
        // machine, and a silent stop is exactly "sometimes the prompt mode is
        // missing". Poll fast for the first six seconds, then slowly forever —
        // the picker stays visible in its own row until the move happens.
        tries += 1;
        return setTimeout(place, tries < 60 ? 100 : 1000);
      }
      const style = document.createElement('style');
      style.textContent = shadowCss;
      sr.appendChild(style);
      // Into the input row itself, not the small container the button sits in: the selector is
      // sized against the row's free space, and a button container has none to give.
      const buttonBox = submit.closest('.input-button-container') || submit.parentElement;
      buttonBox.parentElement.insertBefore(picker, buttonBox);
      const row = document.querySelector('.chat-tools');
      if (row) row.remove();

      // "@" and "/" in the composer, scoped to the page's own workspace.
      //
      // deep-chat's input is a contenteditable/textarea inside this shadow root, so the
      // suggester has to be handed the element directly — there is no `data-suggest`
      // attribute to find from the document, and querySelectorAll does not cross a
      // shadow boundary. The endpoint carries the workspace (and project, where the page
      // has one) so a project's own .claude/ items outrank the global ones, exactly as a
      // session started in that folder would resolve them.
      const suggestInput = sr.querySelector('#text-input, textarea, [contenteditable="true"]');
      if (suggestInput && window.wsSuggest) {
        const scope = document.body.dataset.suggestScope || '';
        window.wsSuggest.attachSuggest(suggestInput, `/fragments/ai-suggest${scope}`);
      }

      // deep-chat re-renders its shadow DOM after applying async config, which
      // silently deletes foreign nodes — the picker survived only when that
      // re-render happened to run first. The JS reference outlives the detach,
      // so a watchdog puts the same node (and its style) back whenever it is
      // dropped, forever — a re-render can happen again on theme changes.
      setInterval(() => {
        if (picker.isConnected) return;
        const sub2 = sr.querySelector('.input-button.inside-end, .input-button.outside-end');
        if (!sub2) return;
        if (!sr.contains(style)) sr.appendChild(style);
        const box2 = sub2.closest('.input-button-container') || sub2.parentElement;
        box2.parentElement.insertBefore(picker, box2);
      }, 1000);
      // No dark copy of these styles, and nothing mirroring the theme in: every colour above is a token, and a
      // custom property set on <html> inherits into the shadow root, so the toggle reaches it on its own.
    };
    place();
  }
  el.errorMessages = { displayServiceErrorMessages: true };
})();

// The actions rail is handled once, near the top of this file, under the `actions-collapsed`
// key that the no-flash script in the page head also reads. A SECOND implementation used to sit
// here — same class, its own `ws-actions-collapsed` key, its own listener bound straight to the
// button — and the two cancelled each other out: the delegated handler toggled the class and wrote
// its key, then this one read the already-toggled class and toggled it back. The rail looked
// broken because every click was undone a millisecond later by the other half of the same feature.

// Reordering the workspaces list by dragging. The buttons stay — a drag is quick for a big move
// and awkward for a single step, and neither is a substitute for the other. The order is posted
// once, on drop, rather than as a run of swaps.
document.addEventListener('dragstart', (e) => {
  const item = e.target.closest && e.target.closest('.ws-item');
  if (!item) return;
  item.classList.add('is-dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', item.dataset.ws || '');
});

document.addEventListener('dragover', (e) => {
  const list = e.target.closest && e.target.closest('.ws-list');
  if (!list) return;
  e.preventDefault();
  const dragging = list.querySelector('.ws-item.is-dragging');
  const over = e.target.closest('.ws-item');
  if (!dragging || !over || over === dragging) return;
  const box = over.getBoundingClientRect();
  const after = e.clientY > box.top + box.height / 2;
  list.insertBefore(dragging, after ? over.nextSibling : over);
});

document.addEventListener('dragend', (e) => {
  const item = e.target.closest && e.target.closest('.ws-item');
  if (!item) return;
  item.classList.remove('is-dragging');
  const editor = item.closest('#list-editor');
  const list = item.closest('.ws-list');
  if (!editor || !list) return;
  const order = [...list.querySelectorAll('.ws-item')].map((li) => li.dataset.ws).join(',');
  htmx.ajax('POST', '/actions/list-order', {
    target: '#list-editor',
    swap: 'outerHTML',
    values: { file: editor.dataset.file, key: editor.dataset.key, order },
  });
});

// Interface directives from the Workspace AI Assistant (HX-Trigger events):
// after the agent creates/starts/launches something, it can steer the page —
// open the new site in a tab and/or navigate to the relevant workspace page.
document.body.addEventListener('assistant-directive', (e) => {
  const d = e.detail || {};
  if (d.open) window.open(d.open, '_blank');
  if (d.navigate) setTimeout(() => { location.href = d.navigate; }, 900);
});

// Global "system is working" indicator: count in-flight HTMX requests and
// toggle html.htmx-busy, which shows the top progress bar + Working… pill.
let activeRequests = 0;
const isJobPoll = (e) => e.detail?.elt?.id?.startsWith('job-');
document.addEventListener('htmx:before:request', (e) => {
  if (isJobPoll(e)) return; // 1s job polls would make the bar flicker forever
  activeRequests += 1;
  document.documentElement.classList.add('htmx-busy');
});
const requestDone = (e) => {
  if (isJobPoll(e)) return;
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) document.documentElement.classList.remove('htmx-busy');
};
document.addEventListener('htmx:after:request', requestDone);
document.addEventListener('htmx:finally:request', requestDone);
document.addEventListener('htmx:error', requestDone);
document.addEventListener('htmx:response:error', requestDone);

// A counter can only ever be as honest as the events that feed it, and a pill that says the
// system is working when it is not is worse than no pill: it is the one piece of chrome you
// cannot dismiss. htmx marks the element it is requesting for with .htmx-request, so that is
// the truth to fall back on — when nothing on the page is in flight, the count is zero,
// whatever the events did or did not say.
setInterval(() => {
  if (!document.documentElement.classList.contains('htmx-busy')) return;
  if (document.querySelector('.htmx-request')) return;
  activeRequests = 0;
  document.documentElement.classList.remove('htmx-busy');
}, 2000);

// Keep live terminal boxes scrolled to the newest output line.
document.addEventListener('htmx:after:swap', (e) => {
  const el = swappedEl(e);
  const pres = [];
  if (el.classList?.contains('terminal')) pres.push(...el.querySelectorAll('.terminal-pre'));
  el.querySelectorAll?.('.terminal .terminal-pre').forEach((p) => pres.push(p));
  pres.forEach((p) => { p.scrollTop = p.scrollHeight; });
});

// Keep the chat log scrolled to the latest message after every HTMX swap.
document.addEventListener('htmx:after:swap', (e) => {
  const el = swappedEl(e);
  const log = document.getElementById('chat-log');
  if (log && (el === log || log.contains(el))) {
    log.scrollTop = log.scrollHeight;
  }
});

// Dark mode toggle (light is the default; choice persists in localStorage).
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-toggle')) return;
  const dark = document.documentElement.classList.toggle('dark');
  wsPrefSet('ws-theme', dark ? 'dark' : 'light');
});

// The command picker inside the prompt: choosing an entry writes a runnable
// phrase into the box and hands focus back, so the prompt stays the one place
// you type. It never runs anything by itself.
document.addEventListener('change', (e) => {
  const picker = e.target.closest('.command-picker');
  if (!picker || !picker.value) return;
  const form = picker.closest('form');
  const input = form && form.querySelector('input[name="message"]');
  if (!input) return;
  const [workspace, file] = picker.value.split('/');
  const phrase = `Run ${file} in ${workspace}: `;
  input.value = input.value ? `${input.value.trim()} ${phrase}` : phrase;
  picker.value = '';
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
});

// The Auto-mode confirm card. "Run it" sends the agreement back as the next turn of the
// conversation (so the agent executes with its own safeguards), "Keep prompting" hands the
// panel back to you.
//
// Two things about WHERE this card lives, both of which silently broke it when the assistant
// became a deep-chat component:
//
//   - The card is drawn INSIDE deep-chat's shadow DOM, so a click on it arrives at the
//     document retargeted to <deep-chat> itself: `e.target.closest('.plan-run')` is null and
//     the handler never ran. `composedPath()` is the path the click actually took, shadow
//     boundary included, and is the only way to see the button from out here.
//   - There is no `.chat-input` form any more — the panel owns its own input — so the turn is
//     sent with deep-chat's own `submitUserMessage`, which puts it in the transcript and posts
//     it exactly as typing it would.
document.addEventListener('click', (e) => {
  const path = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
  const hit = (cls) => path.find((n) => n && n.classList && n.classList.contains(cls));
  const run = hit('plan-run');
  const keep = hit('plan-keep');
  if (!run && !keep) return;
  const chat = document.getElementById('ws-deep-chat');
  if (!chat) return;
  if (keep) {
    const input = chat.shadowRoot && chat.shadowRoot.querySelector('#text-input');
    if (input) input.focus();
    return;
  }
  const card = path.find((n) => n && n.classList && n.classList.contains('plan-card'));
  if (card) card.classList.add('plan-card-done');
  // Both spellings: deep-chat has taken a plain string and an object across versions, and a
  // card that quietly does nothing is exactly the failure this is fixing.
  try { chat.submitUserMessage({ text: 'Yes — run it.' }); }
  catch (_) { try { chat.submitUserMessage('Yes — run it.'); } catch (__) { /* nothing to do */ } }
});

// The image picker in settings. Clicking a tile writes the filename into its field and
// refreshes the preview beside it — the value has to match a file in public/ exactly, so
// picking beats typing, which is why these fields have no microphone.
document.body.addEventListener('click', (e) => {
  const close = e.target.closest('.image-choices-close');
  if (close) { close.closest('.image-picker').innerHTML = ''; return; }
  const tile = e.target.closest('[data-pick-image]');
  if (!tile) return;
  const field = document.getElementById(tile.dataset.pickTarget);
  if (!field) return;
  field.value = tile.dataset.pickImage;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const preview = field.closest('.image-field')?.querySelector('.image-preview');
  if (preview) preview.innerHTML = `<img src="/${tile.dataset.pickImage}" alt="">`;
  tile.closest('.image-picker').innerHTML = '';
  field.focus();
});

// Running commands live in a toast stack.
//
// A job fragment arrives in whatever page area launched it, and polls by replacing ITSELF —
// so moving it into the stack once is enough: every later poll lands wherever the element now
// is. That is why this hooks the swap rather than changing the hx-target of the ~40 buttons
// that start jobs.
//
// Which jobs are collapsed is kept on the STACK, not in a JS variable: the stack survives every
// poll (only its children are replaced), so the state cannot be lost to a re-render or to this
// file being evaluated twice.
function collapsedSet() {
  const stack = document.getElementById('job-toasts');
  return new Set((stack?.dataset.collapsed || '').split(' ').filter(Boolean));
}

function saveCollapsed(set) {
  const stack = document.getElementById('job-toasts');
  if (stack) stack.dataset.collapsed = [...set].join(' ');
}

// A dragged size, like the collapsed state, lives on the stack rather than on the toast: the
// toast element is replaced by its own poll every second, so anything stored on it is gone a
// second later — which is why a resized job used to snap back to its default width.
function toastSizes() {
  const stack = document.getElementById('job-toasts');
  if (!stack) return {};
  try { return JSON.parse(stack.dataset.sizes || '{}'); } catch (_) { return {}; }
}
function setToastSize(id, w, h) {
  const stack = document.getElementById('job-toasts');
  if (!stack) return;
  const all = toastSizes();
  all[id] = { w: Math.round(w), h: Math.round(h) };
  stack.dataset.sizes = JSON.stringify(all);
}

// CSS `resize` only ever gives ONE handle, at the bottom right. These are the eight grips a
// resizable panel is expected to have — four corners and four edges — added by hand for that
// reason. Which edge stays put is fixed by the layout: the stack is bottom-anchored and
// right-aligned, so a toast always grows leftwards and upwards. Dragging outward from any grip
// makes it bigger, dragging inward makes it smaller.
const TOAST_GRIPS = {
  tl: { x: -1, y: -1, cursor: 'nwse-resize', label: 'top-left corner' },
  t:  { x:  0, y: -1, cursor: 'ns-resize',   label: 'top edge' },
  tr: { x:  1, y: -1, cursor: 'nesw-resize', label: 'top-right corner' },
  r:  { x:  1, y:  0, cursor: 'ew-resize',   label: 'right edge' },
  br: { x:  1, y:  1, cursor: 'nwse-resize', label: 'bottom-right corner' },
  b:  { x:  0, y:  1, cursor: 'ns-resize',   label: 'bottom edge' },
  bl: { x: -1, y:  1, cursor: 'nesw-resize', label: 'bottom-left corner' },
  l:  { x: -1, y:  0, cursor: 'ew-resize',   label: 'left edge' },
};
function addToastGrips(toast) {
  if (toast.querySelector('.toast-grip')) return;
  Object.keys(TOAST_GRIPS).forEach((corner) => {
    const g = document.createElement('span');
    g.className = `toast-grip toast-grip-${corner}`;
    g.dataset.grip = corner;
    g.title = `Resize from the ${TOAST_GRIPS[corner].label}`;
    toast.appendChild(g);
  });
}

// The grip lives inside the card, which is a link: a click that lands on it must not navigate.
document.addEventListener('click', (e) => {
  const grip = e.target.closest('.ws-card-handle');
  if (!grip) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('.toast-grip');
  if (!grip) return;
  const toast = grip.closest('.job-toast');
  const dir = TOAST_GRIPS[grip.dataset.grip];
  if (!toast || !dir) return;
  e.preventDefault();
  const box = toast.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const min = { w: 16 * 16, h: 5 * 16 };            // the CSS min-width / min-height, in px
  const max = { w: toast.parentElement.clientWidth, h: window.innerHeight - 96 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // The toast replaces ITSELF every second while the job runs, so the element under the
  // pointer is gone within a second of grabbing it. Everything below works from the id and
  // re-queries the live element, and the size is written to the store on every move — which is
  // what makes the drag survive a poll landing in the middle of it.
  const id = toast.id;
  const move = (ev) => {
    // An outward drag is positive on every grip: the sign per axis comes from which side of the
    // toast the grip is on, so the left grips read a leftward drag as growth and the right ones
    // read a rightward drag the same way. A `0` axis is an edge grip — that dimension is fixed.
    const w = dir.x ? clamp(box.width + dir.x * (ev.clientX - startX), min.w, max.w) : box.width;
    const h = dir.y ? clamp(box.height + dir.y * (ev.clientY - startY), min.h, max.h) : box.height;
    setToastSize(id, w, h);
    const live = document.getElementById(id);
    if (live) { live.style.width = `${w}px`; live.style.height = `${h}px`; }
  };
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.body.classList.remove('toast-resizing');
  };
  document.body.classList.add('toast-resizing');
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
});

function adoptJobToasts() {
  const stack = document.getElementById('job-toasts');
  if (!stack) return;
  const collapsed = collapsedSet();
  const sizes = toastSizes();
  document.querySelectorAll('.job-toast').forEach((toast) => {
    // An inline job (a clone running in its modal) stays where it was swapped in.
    if (toast.classList.contains('job-inline')) return;
    if (toast.parentElement !== stack) stack.appendChild(toast);
    addToastGrips(toast);
    // Re-apply a size the user dragged, for the same reason the collapsed state is re-applied.
    const size = sizes[toast.id];
    if (size) { toast.style.width = `${size.w}px`; toast.style.height = `${size.h}px`; }
    // The server does not know what the user collapsed, and each poll rebuilds the element,
    // so the choice is re-applied here from the stack that remembers it.
    const isCollapsed = collapsed.has(toast.id);
    toast.classList.toggle('is-collapsed', isCollapsed);
    const btn = toast.querySelector('.job-toast-collapse');
    if (btn) btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
    // Follow the tail while it runs, unless the user has scrolled up to read something.
    const pre = toast.querySelector('.terminal-pre');
    if (pre && !isCollapsed && toast.classList.contains('is-running') && !toast.dataset.userScrolled) {
      pre.scrollTop = pre.scrollHeight;
    }
  });
}


document.body.addEventListener('htmx:before:swap', (e) => {
  const el = swappedEl(e);
  if (el && el.id === 'editor-modal-body') {
    el.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch (_) { /* gone */ } });
  }
});

document.addEventListener('DOMContentLoaded', adoptJobToasts);
// Both events: afterSwap puts the element in place, afterSettle runs once htmx has finished
// with it — re-applying at both points is what makes a collapsed job stay collapsed through
// a poll.
document.body.addEventListener('htmx:after:swap', adoptJobToasts);
document.body.addEventListener('htmx:after:swap', adoptJobToasts);

document.addEventListener('click', (e) => {
  const collapse = e.target.closest('.job-toast-collapse');
  if (collapse) {
    const toast = collapse.closest('.job-toast');
    const set = collapsedSet();
    if (set.has(toast.id)) set.delete(toast.id);
    else set.add(toast.id);
    saveCollapsed(set);
    adoptJobToasts();
    return;
  }
  const close = e.target.closest('.job-toast-close');
  if (close) {
    const toast = close.closest('.job-toast');
    const set = collapsedSet();
    set.delete(toast.id);
    saveCollapsed(set);
    // Removing the element stops its polling; the job itself carries on server-side.
    toast.remove();
  }
});

// Reading the output of a long job means scrolling up; do not yank it back to the tail.
document.addEventListener('scroll', (e) => {
  const pre = e.target.closest && e.target.closest('.job-toast .terminal-pre');
  if (!pre) return;
  const toast = pre.closest('.job-toast');
  const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
  if (atBottom) delete toast.dataset.userScrolled;
  else toast.dataset.userScrolled = '1';
}, true);

// Short results become a toast at the top.
//
// A one-line "saved" or "deleted" used to render wherever the form was, which on the settings
// page is below a 60-field form and off-screen — the save looked like it had done nothing. A job
// keeps its own stack at the bottom: that is something you watch, this is something you read once
// and forget, so these fade on their own.
const FLASH_MS = { assistant: 6000, error: 12000 };   // an error is left long enough to read

function flashResults(root) {
  const stack = document.getElementById('flash-toasts');
  if (!stack) return;
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('.msg:not(.terminal):not(.flash-toast)').forEach((msg) => {
    // Leave the chat log and anything inside the modal where they are: those are content, not
    // a transient result.
    //
    // Except a result that ARRIVED in the modal. A form in there (Remove, Clone, Restore, the
    // item forms) posts its own target, so the answer replaces the form — leaving the modal
    // open on a sentence about work already running, with nothing to do but close it by hand.
    // The server marks those `flash-now`; they come out and the modal goes with them.
    if (msg.closest('.chat-log') || msg.closest('#flash-toasts')) return;
    const inModal = msg.closest('#editor-modal');
    if (inModal && !msg.classList.contains('flash-now')) return;
    if (inModal) {
      try { window.UIkit.modal('#editor-modal').hide(); } catch (_) { /* modal already gone */ }
    }
    if (!msg.textContent.trim()) return;
    msg.classList.add('flash-toast');
    const isError = msg.classList.contains('error');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'flash-toast-close';
    close.title = 'Dismiss';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<span uk-icon="icon: close; ratio: .7"></span>';
    msg.appendChild(close);
    stack.appendChild(msg);
    const ms = isError ? FLASH_MS.error : FLASH_MS.assistant;
    // The countdown bar is drawn from this, so the animation and the timer are the same number.
    msg.style.setProperty('--flash-ms', `${ms}ms`);
    // Work that runs in a detached session changes what the page lists — a built project
    // gains a row, a removed one loses it — and the page that started it never hears about
    // it. So the toast that announced the start also asks for a reload as it leaves: by
    // then the row exists, and the reader has had the six seconds to read the message.
    const done = msg.dataset.reloadOnClose ? () => { msg.remove(); reloadForChanges(); } : () => msg.remove();
    let timer = setTimeout(done, ms);
    // Reading a long message must not race the timer.
    msg.addEventListener('mouseenter', () => { clearTimeout(timer); msg.classList.add('is-held'); });
    msg.addEventListener('mouseleave', () => {
      msg.classList.remove('is-held');
      timer = setTimeout(done, 2500);
    });
  });
}

// A reload is not free: it discards whatever is half-typed and any menu that is open. So it
// waits for a moment when it costs nothing — nobody typing, no modal, nothing in flight — and
// gives up rather than fighting the user for the page. Whatever it skips, the next navigation
// shows anyway.
function reloadForChanges() {
  const held = () => {
    const el = document.activeElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && el.type !== 'submit') return 'a field has focus';
    if (document.querySelector('#editor-modal.uk-open')) return 'the modal is open';
    if (document.documentElement.classList.contains('htmx-busy')) return 'a request is in flight';
    if (document.hidden) return 'the tab is in the background';
    return '';
  };
  let tries = 0;
  const attempt = () => {
    if (!held()) { location.reload(); return; }
    // Ten seconds of patience, then leave the page alone.
    if (++tries > 10) return;
    setTimeout(attempt, 1000);
  };
  attempt();
}

document.body.addEventListener('htmx:after:swap', (e) => flashResults(swappedEl(e)));
// An outerHTML swap replaces the element the event names, so the new message can land OUTSIDE
// e.target and never reach the toast stack — which is why a saved card order sometimes showed no
// confirmation at all. A document-wide pass once htmx has settled catches it; flashResults skips
// anything already turned into a toast, so this cannot double up.
document.body.addEventListener('htmx:after:swap', () => flashResults(document));

document.addEventListener('click', (e) => {
  const close = e.target.closest('.flash-toast-close');
  if (!close) return;
  const toast = close.closest('.flash-toast');
  const reload = !!toast.dataset.reloadOnClose;
  toast.remove();
  // Dismissing early is still the toast closing, so the page still catches up. Someone who
  // clicks the × after starting a build wants it gone, not a stale list.
  if (reload) reloadForChanges();
});

// Commands → Buttons: a button carries the row it sits in. Dragged to another row, or moved with its
// select, its hidden row field follows — so what is saved is what is on the screen.
function syncRowButtons() {
  document.querySelectorAll('.row-buttons[data-row]').forEach((list) => {
    list.querySelectorAll(':scope > .row-button').forEach((li) => {
      const input = li.querySelector(':scope > .row-of');
      const select = li.querySelector(':scope > .row-move');
      if (input) input.value = list.dataset.row;
      if (select) select.value = list.dataset.row;
    });
  });
  // …and a group dragged to another column of its menu carries that column.
  document.querySelectorAll('.row-groups[data-col]').forEach((list) => {
    list.querySelectorAll(':scope > .row-group > .gcol-of').forEach((input) => {
      input.value = `${input.dataset.key}\t${list.dataset.col}`;
    });
  });
}
['moved', 'added'].forEach((name) => document.body.addEventListener(name, (e) => {
  if (e.target && e.target.closest && e.target.closest('.row-buttons, .row-groups')) syncRowButtons();
}));
// Commands → Buttons keeps your place. Every change on the Rows tab answers with the editor re-rendered,
// which used to close every card and jump to the top: the open cards and the scroll position are carried over.
// htmx 4 names: before:swap comes from the element that made the request (a form or button inside the
// editor), after:swap names what was swapped — swappedEl() — so the place is put back only when that was the
// editor itself, and forgotten after any smaller swap inside it (Definition's Check report).
let rowEditorPlace = null;
document.body.addEventListener('htmx:before:swap', (e) => {
  const from = e.target && e.target.closest ? e.target.closest('#row-actions-editor') : null;
  if (!from && swappedEl(e).id !== 'row-actions-editor') return;
  rowEditorPlace = {
    buttons: [...document.querySelectorAll('.row-button > details.row-button-body[open]')].map((d) => d.parentElement.dataset.button),
    y: window.scrollY,
  };
});
document.body.addEventListener('htmx:after:swap', (e) => {
  if (!rowEditorPlace) return;
  if (swappedEl(e).id !== 'row-actions-editor') { rowEditorPlace = null; return; }
  const place = rowEditorPlace;
  rowEditorPlace = null;
  place.buttons.forEach((id) => {
    const d = document.querySelector(`.row-button[data-button="${CSS.escape(id)}"] > details.row-button-body`);
    if (d) d.open = true;
  });
  window.scrollTo(0, place.y);
});

// …marks the Rows form as changed, so its save bar can say so and the page can ask before losing it. The
// add-an-action and edit fields are left out: they have their own buttons, and saving the rows ignores them.
function markRowsChanged(el) {
  const form = el && el.closest && el.closest('#row-arrange-form');
  if (!form) return;
  if (el.name && /^(add|edit)_/.test(el.name)) return;
  form.dataset.dirty = '1';
}
['input', 'change'].forEach((name) => document.addEventListener(name, (e) => markRowsChanged(e.target)));
['moved', 'added'].forEach((name) => document.body.addEventListener(name, (e) => markRowsChanged(e.target)));
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('#row-arrange-form .ws-move button')) markRowsChanged(e.target);
});
window.addEventListener('beforeunload', (e) => {
  if (!document.querySelector('#row-arrange-form[data-dirty="1"]')) return;
  e.preventDefault();
  e.returnValue = '';
});

document.addEventListener('change', (e) => {
  const select = e.target && e.target.closest && e.target.closest('.row-move');
  if (!select) return;
  const li = select.closest('.row-button');
  const target = document.querySelector(`.row-buttons[data-row="${CSS.escape(select.value)}"]`);
  if (li && target && li.parentNode !== target) target.appendChild(li);
  syncRowButtons();
});

/* ---------------- the New screen form ------------------------------------- */

// Which fieldsets belong to which kind of session. The kind is a radio now rather than a select: three
// named choices with a line each read better than three words in a dropdown, and the thing being chosen
// changes what the rest of the form asks.
window.screenKindChanged = function screenKindChanged(form) {
  if (!form) return;
  const kind = (form.querySelector('input[name="kind"]:checked') || {}).value || 'shell';
  for (const el of form.querySelectorAll('[data-claude-only]')) el.hidden = kind !== 'claude';
  for (const el of form.querySelectorAll('[data-not-claude]')) el.hidden = kind === 'claude';
  for (const label of form.querySelectorAll('.screen-kind')) {
    label.classList.toggle('is-on', (label.querySelector('input') || {}).checked === true);
  }
};

// The session name follows where it runs, until somebody types their own. It is the first thing
// `screen -ls` shows and what `screen -r` takes, so the answer is almost always the place — but a name
// that overwrote what was typed would be worse than no default at all.
window.screenNameFollowsTarget = function screenNameFollowsTarget(form) {
  if (!form) return;
  const field = form.querySelector('input[name="session"]');
  const target = form.querySelector('select[name="target"]');
  if (!field || !target) return;
  // The same shape the server fills in: where it runs, then a short id so a second session in the same
  // place is not refused as a name that already exists. The id is kept while only the place changes, so
  // watching the name settle does not look like a slot machine.
  const tail = field.dataset.tail || (field.dataset.tail = Math.random().toString(16).slice(2, 6));
  const value = String(target.value || '');
  const derived = (value === 'root'
    ? `workspace-${tail}`
    : `${value.replace(/^p:([a-z0-9_-]+):(.+)$/, '$1--$2').replace(/^ws:/, '')}--${tail}`)
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{3,}/g, '--').slice(0, 60);
  const path = (target.selectedOptions[0] || {}).dataset;
  const line = form.querySelector('.screen-where-path code');
  if (line && path && path.path) line.textContent = path.path;
  if (field.value && field.value !== field.dataset.derived) return;   // typed by hand: leave it alone
  field.value = derived;
  field.dataset.derived = derived;
};

// A prompt template fills the prompt and brings its own flags along, so the session runs the command
// that prompt file documents. The flags land on the controls that own them rather than in a text box.
window.screenPromptTemplate = function screenPromptTemplate(select) {
  const form = select.form;
  if (!select.value || !form) return;
  const flags = (select.selectedOptions[0].dataset.flags || '').trim();
  const tokens = flags.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i].startsWith('--')) continue;
    const field = form.querySelector(`[name="arg_${tokens[i].replace(/^--/, '').replace(/[^A-Za-z0-9]+/g, '_')}"]`);
    if (!field) continue;
    const next = tokens[i + 1];
    if (field.type === 'checkbox') { field.checked = true; continue; }
    if (next && !next.startsWith('--')) { field.value = next; i += 1; }
  }
  fetch(`/fragments/prompt-text/${encodeURIComponent(select.value)}`)
    .then((r) => r.text())
    .then((t) => {
      const text = t.trim();
      const field = form.querySelector('textarea[name="command"]');
      if (!field) return;
      field.value = text;
      if (field._aceEditor) { field._aceEditor.session.setValue(text); field._aceEditor.focus(); } else field.focus();
    });
};

// The form arrives in the editor modal, and its "where it runs" half is swapped again whenever the
// workspace changes — so both the kind toggle and the name default are settled here rather than from an
// inline handler on an element the swap may have replaced.
document.body.addEventListener('htmx:after:settle', (e) => {
  const el = e.target;
  if (!el || !el.querySelector) return;
  const kinds = el.querySelector('form .screen-kinds') || (el.closest && el.closest('form') && el.matches('.screen-kinds') ? el : null);
  if (kinds) window.screenKindChanged(kinds.closest('form'));
  const where = el.id === 'screen-where' ? el : el.querySelector('#screen-where');
  if (where && where.closest('form')) window.screenNameFollowsTarget(where.closest('form'));
});

// The Screens page: how many sessions across.
//
// One under another by DEFAULT, and that is the point of the default rather than an accident of CSS: a
// session row carries its name, its state, its log path and five verbs, and two of those side by side
// on a 1400px screen leaves each narrower than the buttons it holds. Two and three across are for a
// machine with a dozen sessions, where the question is "which of these is waiting" rather than "what
// does this one say".
//
// Re-applied after every swap because the list refreshes itself every 20 seconds — a class set once
// would last exactly one poll. Kept per browser, like the theme and the page width.
(function screensColumns() {
  const KEY = 'ws-screens-cols';
  const read = () => {
    try { return ['1', '2', '3'].includes(localStorage.getItem(KEY)) ? localStorage.getItem(KEY) : '1'; }
    catch (_) { return '1'; }
  };
  function apply() {
    const list = document.querySelector('.screens-list');
    // The modal only wears the count while it is actually holding the list: it is the one modal in the
    // dashboard, and an editor opened after the screens would otherwise inherit a width chosen for
    // three columns of session cards.
    const modal = document.getElementById('editor-modal');
    if (modal) {
      if (modal.contains(list)) modal.dataset.screensCols = read();
      else delete modal.dataset.screensCols;
    }
    if (!list) return;
    const cols = read();
    list.dataset.cols = cols;
    // The buttons only: the modal itself carries data-screens-cols for its width, and as a match it was
    // being given the primary button's class, which painted the whole overlay brand blue.
    document.querySelectorAll('button[data-screens-cols]').forEach((b) => {
      const on = b.dataset.screensCols === cols;
      b.classList.toggle('uk-button-primary', on);
      b.classList.toggle('uk-button-default', !on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-screens-cols]');
    if (!btn) return;
    e.preventDefault();
    try { localStorage.setItem(KEY, btn.dataset.screensCols); } catch (_) { /* private window */ }
    apply();
  });
  document.addEventListener('DOMContentLoaded', apply);
  document.body.addEventListener('htmx:after:swap', apply);
  apply();
})();

/* ---------------- the name the Build form proposes ---------------- */
//
// Choosing a builder fills the name field with something derived from what it builds, numbered past
// what is already in that folder — `byte1`, then `byte2` — because a form that says only
// `new-project-name` is how a tree ends up holding `my-drupal-site`, `my-drupal-site-pulse` and
// `my-drupal-site-pulse2`.
//
// The one rule: a name somebody TYPED is never overwritten. The field is filled only while it is
// empty, or while it still holds the exact suggestion this code last put there — so changing the
// dropdown re-proposes, and changing it after typing leaves the typing alone.
(function () {
  let lastSuggested = '';
  document.body.addEventListener('suggest-project-name', (e) => {
    const name = typeof e.detail === 'string' ? e.detail : (e.detail && e.detail.value);
    if (!name) return;
    document.querySelectorAll('input[data-suggest-name]').forEach((input) => {
      const now = input.value.trim();
      if (now !== '' && now !== lastSuggested) return;   // theirs, not ours
      input.value = name;
    });
    lastSuggested = name;
  });
})();

// Who is signed in, when the dashboard asks for Google sign-in: the name and a way out. With sign-in off
// /auth/me says so and nothing is drawn.
(function () {
  var slot = document.getElementById('auth-user');
  if (!slot || !window.fetch) return;
  fetch('/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
    if (!u || !u.enabled || !u.email) return;
    slot.textContent = '';
    var who = document.createElement('span');
    who.textContent = u.name || u.email;
    who.title = u.email;
    var out = document.createElement('a');
    out.href = '/auth/signout';
    out.textContent = 'Sign out';
    out.className = 'uk-margin-small-left';
    slot.appendChild(who);
    slot.appendChild(out);
    slot.hidden = false;
  }).catch(function () {});
})();

// The image viewer: fit or actual size, and the arrow keys step through the list it was opened from.
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-img-zoom]') : null;
  if (!btn) return;
  const stage = btn.closest('[data-img-viewer]') && btn.closest('[data-img-viewer]').querySelector('[data-img-stage]');
  if (!stage) return;
  const fit = stage.classList.toggle('is-fit');
  btn.textContent = fit ? 'Actual size' : 'Fit';
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const viewer = document.querySelector('#editor-modal.uk-open [data-img-viewer]');
  if (!viewer || e.target.closest('input, textarea, select, [contenteditable]')) return;
  const btn = viewer.querySelector(e.key === 'ArrowLeft' ? '[data-img-prev]' : '[data-img-next]');
  if (!btn) return;
  e.preventDefault();
  btn.click();
});

// Upload images: each file is its own request with its bytes as the body, then the gallery refreshes.
async function uploadImages(box, files) {
  const log = box.querySelector('[data-img-upload-log]');
  const folder = (box.querySelector('[data-img-upload-folder]') || {}).value || '';
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = `${f.name}…`;
    log.appendChild(li);
    try {
      const r = await fetch(`/actions/image-upload?path=${encodeURIComponent(folder)}&name=${encodeURIComponent(f.name)}`,
        { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
      li.innerHTML = await r.text();
    } catch (err) {
      li.textContent = `${f.name}: ${err.message}`;
    }
  }
  if (window.htmx) htmx.trigger(document.body, 'refresh-projects');
}
document.addEventListener('change', (e) => {
  const input = e.target && e.target.matches && e.target.matches('[data-img-upload-input]') ? e.target : null;
  if (input && input.files.length) uploadImages(input.closest('[data-img-upload]'), [...input.files]);
});
['dragover', 'dragleave', 'drop'].forEach((type) => document.addEventListener(type, (e) => {
  const zone = e.target && e.target.closest ? e.target.closest('[data-img-drop]') : null;
  if (!zone) return;
  e.preventDefault();
  zone.classList.toggle('is-over', type === 'dragover');
  if (type === 'drop' && e.dataTransfer.files.length) uploadImages(zone.closest('[data-img-upload]'), [...e.dataTransfer.files]);
}));

// Choosing a DDEV quickstart fills the fields beside it; each can still be changed.
document.addEventListener('change', (e) => {
  const sel = e.target && e.target.closest ? e.target.closest('select[data-ddev-preset]') : null;
  if (!sel) return;
  const o = sel.selectedOptions[0];
  const box = sel.closest('.ddev-options');
  if (!o || !o.value || !box) return;
  ['project_type', 'php_version', 'database', 'webserver_type'].forEach((k) => {
    const f = box.querySelector(`[name="${k}"]`);
    const v = o.dataset[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
    if (f && v !== undefined) f.value = v;
  });
  const root = box.querySelector('[name="docroot"]');
  if (root) root.value = o.dataset.docroot === '__default' ? '' : (o.dataset.docroot || '');
  const omit = box.querySelector('[name="omit_db"]');
  if (omit) omit.checked = o.dataset.omitDb === '1';
  const py = box.querySelector('[name="python"]');
  if (py) py.checked = o.dataset.python === '1';
});

// Deleting a workspace: Enter in a step's field answers that step instead of submitting the settings form around it.
document.addEventListener('keydown', (e) => {
  const field = e.key === 'Enter' && e.target.closest && e.target.closest('.ws-delete-step input');
  if (!field) return;
  e.preventDefault();
  const go = field.closest('.ws-delete-step').querySelector('.ws-delete-go');
  if (go) go.click();
});
// Focus the step's field after the swap, and again once the confirm dialog has closed, which hands focus to the body.
const focusWsDeleteStep = () => {
  const field = document.querySelector('.ws-delete-step input');
  if (field && document.activeElement !== field) field.focus();
};
document.body.addEventListener('htmx:after:swap', focusWsDeleteStep);
document.addEventListener('hidden', (e) => { if (e.target && e.target.id === 'confirm-modal') setTimeout(focusWsDeleteStep, 0); }, true);
