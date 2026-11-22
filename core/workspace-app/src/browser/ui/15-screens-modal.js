
// "Open in Screens": a session asked for by name is shown first — its state and the end of its log
// while it runs, and the end of its log when it has already ended — so a short command can be read
// after it is gone. One loader keeps that box fresh wherever it is drawn: in the Screens modal
// (/fragments/screens?session=<name>) and on the Screens page (/screens?session=<name>).
function followAskedSession(box, name) {
  if (!box || box.dataset.following === '1') return;
  box.dataset.following = '1';
  const load = () => {
    if (!box.isConnected) return;          // the modal closed, or the page moved on
    fetch(`/fragments/screen-asked/${encodeURIComponent(name)}`)
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        if (!html || !box.isConnected) return;
        // Somebody reading up the log is not pulled back to its end.
        const pre = box.querySelector('.terminal-pre');
        const follow = !pre || pre.scrollHeight - pre.scrollTop - pre.clientHeight < 24;
        box.innerHTML = html;
        const now = box.querySelector('.terminal-pre');
        if (now && follow) now.scrollTop = now.scrollHeight;
        if (box.querySelector('.is-running')) setTimeout(load, 3000);
      })
      .catch(() => { /* the list below still says what runs */ });
  };
  // Drawn by the server already (the modal): only a running one is asked about again.
  if (box.querySelector('.screen-asked')) {
    const pre = box.querySelector('.terminal-pre');
    if (pre) pre.scrollTop = pre.scrollHeight;
    if (box.querySelector('.is-running')) setTimeout(load, 3000);
  } else load();
}
(function showAskedSession() {
  if (window.location.pathname !== '/screens') return;
  const name = new URLSearchParams(window.location.search).get('session') || '';
  if (!/^[a-z0-9][A-Za-z0-9._-]*$/.test(name)) return;
  const place = () => {
    const list = document.getElementById('webship-workspace-projects');
    if (!list) return;
    const box = document.createElement('div');
    box.id = 'screen-asked';
    // First in the page's card: above the list and above a panel a plugin draws over it.
    list.parentElement.prepend(box);
    followAskedSession(box, name);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
  else place();
})();
document.body.addEventListener('htmx:after:swap', (e) => {
  if (swappedEl(e)?.id !== 'editor-modal-body') return;
  document.querySelectorAll('#editor-modal-body .screen-asked-box[data-asked-session]').forEach((box) => followAskedSession(box, box.dataset.askedSession));
});

// Screens open in the modal, over the page one is on — the same modal the top bar's Screens button
// opens (/fragments/screens into #editor-modal-body), never a second kind. A link to /screens is
// such an opening wherever it is drawn: the "Open in Screens" of a notice (the dashboard's or a
// plugin runner's), "already running … Open in Screens", a row's "All screens", the rail's Screens
// entry, "watch it on Screens". With ?session=<name> that session is first in the modal.
// The address itself still works: typed, opened in a new tab (Ctrl/middle click), or followed from
// the modal's own "the Screens page" link (data-screens-page), it is the page.
function screensModalUrl(href) {
  let u;
  try { u = new URL(href, window.location.origin); } catch (_) { return ''; }
  if (u.origin !== window.location.origin || u.pathname !== '/screens') return '';
  const name = u.searchParams.get('session') || '';
  return /^[a-z0-9][A-Za-z0-9._-]*$/.test(name) ? `/fragments/screens?session=${encodeURIComponent(name)}` : '/fragments/screens';
}
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (a.target === '_blank' || a.hasAttribute('download') || a.hasAttribute('data-screens-page')) return;
  if (!window.htmx || !document.getElementById('editor-modal-body')) return;
  const url = screensModalUrl(a.getAttribute('href'));
  if (!url) return;
  // On the Screens page its own entry in the rail is the page: there is nothing to open over it.
  if (window.location.pathname === '/screens' && url === '/fragments/screens') return;
  e.preventDefault();
  window.htmx.ajax('GET', url, { target: '#editor-modal-body', swap: 'innerHTML' });
});

// Past sessions (screens.js): the sessions the dashboard started that are gone, each read in the modal, resumed or
// forgotten. Focus goes where the person's next step is: to the top of a conversation when it opens, back to the
// Read button it was opened from, to a neighbour when a row is forgotten, and to Open terminal when one resumes.
const pastFocus = { read: null, forgetAt: -1, resumed: false };
function focusInModalSoon(el) {
  if (!el) return;
  const modal = document.getElementById('editor-modal');
  const go = () => { try { el.focus(); } catch (_) { /* gone again */ } };
  if (!modal || modal.classList.contains('uk-open')) { setTimeout(go, 0); return; }
  // Opening: after the modal's own handler has put focus on the dialog.
  const once = (ev) => { if (ev.target !== modal) return; document.removeEventListener('shown', once); setTimeout(go, 0); };
  document.addEventListener('shown', once);
}
document.addEventListener('click', (e) => {
  const t = e.target.closest ? e.target : null;
  if (!t) return;
  const read = t.closest('.screens-past-read');
  if (read) {
    const row = read.closest('[data-note]');
    pastFocus.read = { note: row ? row.dataset.note : '', inModal: !!read.closest('#editor-modal') };
    return;
  }
  const forget = t.closest('.screens-past-forget');
  if (forget) {
    const rows = [...forget.closest('.screens-past').querySelectorAll('.screens-past-row')];
    pastFocus.forgetAt = rows.indexOf(forget.closest('.screens-past-row'));
    return;
  }
  if (t.closest('.screens-past-resume, .screen-note-verbs [hx-post="/actions/screen-resume"]')) { pastFocus.resumed = true; return; }
  const back = t.closest('[data-screen-note-back]');
  if (!back) return;
  e.preventDefault();
  const from = pastFocus.read && pastFocus.read.note === back.dataset.screenNoteBack
    ? pastFocus.read : { note: back.dataset.screenNoteBack, inModal: true };
  // Read from the Screens page: the list is the page behind, and closing the modal is going back (focus returns to
  // the Read button that opened it). Read from the Screens modal: the modal shows the list again.
  if (!from.inModal) { try { window.UIkit.modal('#editor-modal').hide(); } catch (_) { /* no modal */ } return; }
  pastFocus.read = { ...from, back: true };
  window.htmx.ajax('GET', '/fragments/screens', { target: '#editor-modal-body', swap: 'innerHTML' });
});
document.body.addEventListener('htmx:after:settle', (e) => {
  const el = swappedEl(e);
  if (!el) return;
  if (el.id === 'editor-modal-body' && el.querySelector('.screen-note')) {
    el.scrollTop = 0;          // from the top, wherever the list it was opened from had been scrolled to
    focusInModalSoon(el.querySelector('#screen-note-title'));
  } else if (el.id === 'editor-modal-body' && pastFocus.read && pastFocus.read.back) {
    const { note } = pastFocus.read;
    pastFocus.read = null;
    const row = [...el.querySelectorAll('.screens-past-row')].find((r) => r.dataset.note === note);
    focusInModalSoon((row && row.querySelector('.screens-past-read')) || el.querySelector('#screens-past-title'));
  } else if (el.classList.contains('screens-past') && pastFocus.forgetAt >= 0) {
    const rows = [...el.querySelectorAll('.screens-past-row')];
    const row = rows[Math.min(pastFocus.forgetAt, rows.length - 1)];
    pastFocus.forgetAt = -1;
    const next = (row && row.querySelector('.screens-past-forget')) || el.querySelector('.screens-past-title');
    if (next) next.focus();
  } else if (pastFocus.resumed && (el.classList.contains('screens-past-result') || el.id === 'screen-note-result')) {
    pastFocus.resumed = false;
    // On the Screens page the notice has become a toast at the top by now; inside the modal it stayed here.
    const opens = [...document.querySelectorAll('.screen-resumed [data-open-terminal]')];
    const open = opens[opens.length - 1];
    if (open) open.focus();
  }
});

// Short results become a toast at the top.
//
// A one-line "saved" or "deleted" used to render wherever the form was, which on the settings
// page is below a 60-field form and off-screen — the save looked like it had done nothing. They
// are read once and forgotten, so they fade on their own — except one marked `flash-stay` (a
// command line to copy), which stays until it is closed.
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
    // A notice is one sentence beside its mark. The toast is a flex row, so a notice whose words are not
    // in one wrapper is laid out as a column per piece — "git status" | "on" | "r7-alpha" | "—" | "Open in
    // Screens", each wrapping on its own on a phone. The dashboard's notices carry .notice-text; a plugin's
    // may not, so a message that is not already one wrapper is put in one here.
    const loose = [...msg.childNodes].filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    if (!(loose.length === 1 && loose[0].nodeType === 1)) {
      const text = document.createElement('div');
      text.className = 'notice-text';
      while (msg.firstChild) text.appendChild(msg.firstChild);
      msg.appendChild(text);
    }
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
    // Something to act on (a command to copy) is not on a timer: its close button is the way out.
    if (msg.classList.contains('flash-stay')) { msg.classList.add('is-held'); return; }
    // An error is not on a timer either: it says what went wrong and what to do, and a person reading
    // with a magnifier, a screen reader or simply slowly must not lose it after twelve seconds. It is
    // said at once (role="alert"), and its close button is the way out.
    if (isError) { msg.setAttribute('role', 'alert'); msg.classList.add('is-held'); return; }
    let timer = setTimeout(done, ms);
    // Reading a long message must not race the timer: the pointer over it holds it, and so does
    // keyboard focus inside it (its link, its close button).
    const hold = () => { clearTimeout(timer); msg.classList.add('is-held'); };
    const release = () => {
      if (msg.matches(':hover') || msg.contains(document.activeElement)) return;
      msg.classList.remove('is-held');
      clearTimeout(timer);
      timer = setTimeout(done, 2500);
    };
    msg.addEventListener('mouseenter', hold);
    msg.addEventListener('focusin', hold);
    msg.addEventListener('mouseleave', release);
    msg.addEventListener('focusout', () => setTimeout(release, 0));
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
  // Following a notice's link is using the notice, so it closes as its × would. Its "Open in Screens"
  // opens the Screens modal under it, and a notice sits above modals and is held while the pointer is
  // over it — which, having just clicked it, the pointer is: it covered the modal's heading and its
  // Close button until the pointer moved away. An error, or a notice that stays until it is closed (a
  // command to copy), is kept: its link is one of the things to do with it, not the end of it.
  const link = close ? null : e.target.closest('.flash-toast a[href]');
  const toast = (close || link) ? (close || link).closest('.flash-toast') : null;
  if (!toast) return;
  if (link && (toast.classList.contains('error') || toast.classList.contains('flash-stay'))) return;
  const reload = !!toast.dataset.reloadOnClose;
  // After the click has done its own work (the link's navigation, or the modal it opens): removing the
  // link while its click is still being handled is not something to rely on.
  if (link) setTimeout(() => toast.remove(), 0); else toast.remove();
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

