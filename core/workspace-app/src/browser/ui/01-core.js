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
//
// The event's detail carries the request's context, and the swapped element is its target
// (detail.ctx.target); detail.target is not set. Read from detail.target alone this answered the
// button that asked — so a modal opened by a row's Clone or Configure DDEV button (hx-target
// #editor-modal-body) never learned who opened it, and closing it gave focus back to nothing.
//
// In an outerHTML swap htmx 4 names the FIRST node it put in, and when the answer starts with a line break
// (a job's view, which polls and replaces itself every second) that is a text node, with no id and no
// classList. The element is then the first one among what was put in (detail.newContent), else the
// node's parent (#634).
function swappedEl(e) {
  const d = e.detail || {};
  const t = d.target || (d.ctx && d.ctx.target);
  const el = t && t.nodeType === 1 ? t : e.target;
  if (!el || el.nodeType === 1) return el;
  const added = Array.isArray(d.newContent) ? d.newContent.find((n) => n && n.nodeType === 1) : null;
  return added || el.parentElement || el;
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

let editorModalOpener = null;
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
    // What had focus when the modal was asked for gets it back when the modal closes.
    const modal = document.getElementById('editor-modal');
    if (modal && !modal.classList.contains('uk-open') && !editorModalOpener) {
      const from = document.activeElement;
      editorModalOpener = from && from !== document.body && !modal.contains(from) ? from : null;
    }
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
    // The notices stay in reach: a form in the modal that answers into the page (Run a tool) gets its
    // notice over the modal, and its "Open in Screens" link or its Copy button must work there.
    if (el === modal || el.contains(modal) || el.id === 'confirm-modal' || el.id === 'flash-toasts' || el.tagName === 'SCRIPT'
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
// The modal is named by what it shows (#811): aria-labelledby on the heading of the content swapped into it, which is
// given an id when it has none. UIkit puts role="dialog" on the inner .uk-modal-dialog, and it has been seen on
// #editor-modal itself, so both are named. With no heading, the markup's aria-label ("Editor") is the name.
function nameEditorModal() {
  const modal = document.getElementById('editor-modal');
  if (!modal) return;
  const h = modal.querySelector('#editor-modal-body .modal-head h3, #editor-modal-body h3, #editor-modal-body h2, #editor-modal-body h1');
  const heading = h && h.textContent.replace(/\s+/g, ' ').trim() ? h : null;
  if (heading && !heading.id) heading.id = 'editor-modal-title';
  for (const el of [modal, modal.querySelector('.uk-modal-dialog')]) {
    if (!el) continue;
    if (heading) el.setAttribute('aria-labelledby', heading.id); else el.removeAttribute('aria-labelledby');
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Editor');
  }
}
// Who opened the modal, taken as it starts to open, whichever way it was opened: a button with
// uk-toggle, a row button that shows it from hx-on::after:request (Clone, Configure DDEV, New screen
// here…) before its content has arrived, or a script. The swap handler above only saw the ones whose
// content came first; for the others the modal was already open by then, so nothing was recorded and
// closing it gave focus back to nothing.
document.addEventListener('beforeshow', (e) => {
  if (!e.target || e.target.id !== 'editor-modal' || editorModalOpener) return;
  const from = document.activeElement;
  editorModalOpener = from && from !== document.body && !e.target.contains(from) ? from : null;
});
document.addEventListener('shown', (e) => {
  if (!e.target || e.target.id !== 'editor-modal') return;
  containEditorModal(true);
  nameEditorModal();
  // Focus goes into the dialog itself (the element that has role="dialog" and the name), so a screen
  // reader says "Settings, dialog" and Tab starts inside; it was left on the unnamed wrapper around it.
  const dialog = e.target.querySelector('.uk-modal-dialog');
  if (dialog && !dialog.contains(document.activeElement)) {
    dialog.tabIndex = -1;
    dialog.focus({ preventScroll: true });
  }
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
  // Back to where the person was: without this a keyboard user started again from the top of the page.
  const opener = editorModalOpener;
  editorModalOpener = null;
  if (opener && opener.isConnected) setTimeout(() => { try { opener.focus(); } catch (_) { /* it is gone */ } }, 0);
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
  (root && typeof root.querySelectorAll === 'function' ? root : document).querySelectorAll('img[data-svg-motion]:not([data-svg-watched])').forEach((img) => {
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
// UIkit emits `beforeshow` on the dropdown, and htmx listens for `menu-opened` on the list inside it —
// or on the dropdown itself, when the whole body loads as it opens (a plugin's lazy row menu). The
// relay, rather than `hx-trigger="beforeshow"` on the dropdown: a nav inside a menu emits `beforeshow`
// too when it unfolds, and that bubbling up must not fetch the menu again under the pointer.
document.addEventListener('beforeshow', (e) => {
  const t = e.target;
  if (!t || !t.querySelector) return;
  const list = (t.matches && t.matches('[hx-trigger*="menu-opened"]')) ? t : t.querySelector('[hx-trigger*="menu-opened"]');
  if (list) list.dispatchEvent(new CustomEvent('menu-opened'));
}, true);

// A menu that closes with focus inside it gives focus back to the button that opened it.
//
// Escape closed a row menu (GIT, DDEV, SCREENS, a host's menu) and left focus on the item that had just
// been hidden, so the browser dropped it to <body>: no ring anywhere, and the next Tab started again from
// the top of the page. A pick that opens the editor modal had the same hole one step later — the item was
// gone when the menu closed, so the modal had nothing to give focus back to. The menu's own button
// (UIKit's targetEl) gets it, unless something else has taken it by then: a modal the pick opened, a field
// it revealed.
document.addEventListener('beforehide', (e) => {
  const drop = e.target;
  if (!window.UIkit || !drop || !drop.classList || !drop.classList.contains('uk-dropdown')) return;
  if (!drop.contains(document.activeElement)) return;
  let button = null;
  try { button = window.UIkit.dropdown(drop).targetEl; } catch (_) { /* not a dropdown any more */ }
  if (!button || typeof button.focus !== 'function') return;
  setTimeout(() => {
    const now = document.activeElement;
    if (now && now !== document.body && !drop.contains(now)) return;
    if (button.isConnected) button.focus();
  }, 0);
});

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

