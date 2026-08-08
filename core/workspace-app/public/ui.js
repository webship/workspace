/* Tiny progressive-enhancement layer on top of HTMX (no frameworks, no modals). */

// Two-step arm/confirm for destructive Remove buttons: first click arms the
// button (no browser confirm() dialog), second click within 5s fires the
// HTMX request via the custom 'confirmed-remove' trigger.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.arm-step');
  if (!btn) return;
  if (btn.dataset.armed !== '1') {
    e.preventDefault();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = '⚠️ Sure?';
    btn.classList.add('arm');
    setTimeout(() => {
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.label || '🗑️ Remove';
      btn.classList.remove('arm');
    }, 5000);
    return;
  }
  btn.dataset.armed = '0';
  btn.textContent = btn.dataset.label || '🗑️ Remove';
  btn.classList.remove('arm');
  window.htmx && window.htmx.trigger(btn, 'confirmed-remove');
});

// Voice input: mic button uses the browser's Web Speech API to dictate into
// the chat input. Hidden automatically where the API isn't supported.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

document.addEventListener('DOMContentLoaded', () => {
  if (!SpeechRecognition) {
    document.querySelectorAll('.mic-btn').forEach((b) => { b.hidden = true; });
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mic-btn');
  if (!btn || !SpeechRecognition) return;
  const input = btn.closest('form').querySelector('input[name="message"]');
  const rec = new SpeechRecognition();
  rec.lang = document.documentElement.lang || 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  btn.classList.add('listening');
  rec.onresult = (ev) => {
    input.value = ev.results[0][0].transcript;
    input.focus();
  };
  rec.onerror = () => { /* mic denied or no speech — just stop listening */ };
  rec.onend = () => btn.classList.remove('listening');
  rec.start();
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
document.addEventListener('htmx:beforeRequest', (e) => {
  if (isJobPoll(e)) return; // 1s job polls would make the bar flicker forever
  activeRequests += 1;
  document.documentElement.classList.add('htmx-busy');
});
const requestDone = (e) => {
  if (isJobPoll(e)) return;
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) document.documentElement.classList.remove('htmx-busy');
};
document.addEventListener('htmx:afterRequest', requestDone);
document.addEventListener('htmx:sendError', requestDone);
document.addEventListener('htmx:responseError', requestDone);

// Keep live terminal boxes scrolled to the newest output line.
document.addEventListener('htmx:afterSwap', (e) => {
  const pres = [];
  if (e.target.classList?.contains('terminal')) pres.push(...e.target.querySelectorAll('.terminal-pre'));
  e.target.querySelectorAll?.('.terminal .terminal-pre').forEach((p) => pres.push(p));
  pres.forEach((p) => { p.scrollTop = p.scrollHeight; });
});

// Keep the chat log scrolled to the latest message after every HTMX swap.
document.addEventListener('htmx:afterSwap', (e) => {
  const log = document.getElementById('chat-log');
  if (log && (e.target === log || log.contains(e.target))) {
    log.scrollTop = log.scrollHeight;
  }
});

// Dark mode toggle (light is the default; choice persists in localStorage).
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-toggle')) return;
  const dark = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('ws-theme', dark ? 'dark' : 'light'); } catch (_) { /* private mode */ }
});

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
  let cfg = { voiceInput: true, submitAfterSilence: 2500, voiceOutput: true, speechRate: 1, intro: true };
  try { cfg = { ...cfg, ...JSON.parse(el.dataset.settings || '{}') }; } catch (_) { /* keep the defaults */ }

  el.connect = {
    url: '/actions/deep-chat',
    method: 'POST',
    additionalBodyProps: { context },
  };

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
    return response;
  };

  // Voice in, using the browser's own speech recognition — no key, no service, and it stops on
  // its own after a pause rather than needing a second click. `false` removes the microphone
  // rather than leaving a button that does nothing.
  el.speechToText = cfg.voiceInput ? {
    webSpeech: true,
    displayInterimResults: true,
    stopAfterSubmit: true,
    // 0 means never send for you: deep-chat wants the key absent for that, not zero.
    ...(cfg.submitAfterSilence ? { submitAfterSilence: cfg.submitAfterSilence } : {}),
  } : false;

  // Voice out as well as in: the assistant reads its answer aloud, which is the half that makes
  // asking by voice worth doing — you can start a build and listen to what it says while looking
  // somewhere else. The browser's own synthesis, so no key and no service.
  el.textToSpeech = cfg.voiceOutput ? { volume: 1, rate: cfg.speechRate, pitch: 1 } : false;

  // The prompt is the main control of this panel, so it is sized like one rather than like a
  // single-line search box: room for a few lines of a real instruction before it scrolls.
  el.textInput = {
    placeholder: { text: (() => {
      // The placeholder should not offer voice on a panel that has none.
      const voice = cfg.voiceInput ? ' (or use voice)' : '';
      return context.startsWith('workspace:')
        ? `Ask about ${context.split(':')[1]}…${voice}`
        : `Ask me anything…${voice}`;
    })() },
    styles: {
      container: {
        minHeight: '4.5rem',
        maxHeight: '11rem',
        borderRadius: '0.85rem',
        padding: '0.65rem 0.9rem',
        boxShadow: '0 1px 2px rgba(0,0,0,.06)',
      },
      text: { fontSize: '1rem', lineHeight: '1.45' },
    },
  };

  // The opening message is rendered by the server into a template beside the component, because
  // what it should say depends on the page and that is known there, not here.
  const introTpl = document.getElementById('ws-chat-intro');
  if (introTpl) el.introMessage = { html: introTpl.innerHTML };


  // A build is minutes of work, so the component must not give up on the request.
  // The look, in the dashboard's own palette rather than a stock preset: the user's turn carries
  // the brand gradient the rest of the interface uses, and the assistant's sits on a plain surface
  // so long technical replies stay readable.
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
        },
      },
      user: {
        bubble: {
          background: 'linear-gradient(135deg, #1e87f0, #6d5bd0 65%, #9b5cf6)',
          color: '#fff',
        },
      },
      ai: {
        bubble: { backgroundColor: '#f6f7fc', color: '#232946' },
      },
    },
    // Since 2.1.0 the loading bubble is styled through its own shape, not a plain bubble object.
    loading: { message: { styles: { bubble: { backgroundColor: '#f6f7fc' } } } },
    error: { bubble: { backgroundColor: '#fdeaee', color: '#c0304a', fontSize: '0.9rem' } },
  };

  // Injected into the component's shadow root, which is the only way to reach what deep-chat
  // renders inside itself: dark mode, and the typography of the markdown we return.
  el.auxiliaryStyle = `
    .dc-reply p { margin: 0 0 .5rem; }
    .dc-reply p:last-child { margin-bottom: 0; }
    .dc-reply pre { background: rgba(0,0,0,.06); padding: .5rem .65rem; border-radius: .5rem; overflow-x: auto; }
    .dc-reply code { font-size: .88em; }
    .dc-reply table { border-collapse: collapse; width: 100%; font-size: .9em; }
    .dc-reply th, .dc-reply td { border: 1px solid rgba(0,0,0,.12); padding: .3rem .45rem; text-align: left; }
    .dc-intro ul { margin: .25rem 0 0; padding-left: 1.1rem; }
    .dc-intro li { margin: .15rem 0; }
  `;

  el.requestBodyLimits = { maxMessages: 1 };

  // Prompt mode lives in deep-chat's own input toolbar, beside the send button, the way
  // ai_agent_modes puts its compact selector in the message box toolbar. deep-chat builds that
  // toolbar itself, so the select is rendered in the page and moved in once it exists.
  const picker = document.querySelector('.chat-tools .command-picker');
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
        border: 1px solid #d8dae5;
        border-radius: 12px;
        padding: 8px 10px;
        background-color: #fff;
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

      /* The send button is the blue square of the toolbar, sized to the selector beside it so the
         row reads as one control rather than three of different heights. */
      .input-button.inside-end {
        width: 34px;
        height: 34px;
        box-sizing: border-box;
        padding: 0 !important;
        border-radius: 8px;
        background-color: #1e87f0 !important;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* deep-chat tints its icons with an inline filter, so the icon colour has to be forced the
         same way the background was. On the blue square the arrow is white. */
      .input-button.inside-end svg { width: 17px !important; height: 17px !important; filter: brightness(0) invert(1) !important; }
      .input-button.inside-end.disabled-button svg { filter: none !important; }
      .input-button.inside-end.disabled-button svg, .input-button.inside-end.disabled-button svg * {
        stroke: #9aa0bd !important;
        fill: none !important;
      }
      .input-button.inside-end:hover { background-color: #1a74cf !important; }
      /* Disabled is the resting state — there is nothing to send until something is typed — so it
         has to read as inactive rather than as a broken blue button. */
      .input-button.inside-end.disabled-button { background-color: #eceef7 !important; }
      .input-button.inside-end.disabled-button svg { filter: none; opacity: .45; }
      #input.is-dark .input-button.inside-end.disabled-button { background-color: #232a42 !important; }

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
        background-color: #6d5bd0 !important;
      }
      /* The microphone is a filled icon, so it is coloured rather than filtered — the same ink the
         rest of the interface uses, not deep-chat's green tint. */
      .input-button.outside-end svg { width: 17px !important; height: 17px !important; filter: none !important; }
      .input-button.outside-end svg, .input-button.outside-end svg * { fill: #fff !important; }
      .input-button.outside-end:hover { background-color: #5c4bb8 !important; }
      /* While it is listening it is the active control in the row, so it says so. */
      .input-button.outside-end.active-button { background-color: #1e87f0 !important; }
      .input-button.outside-end.active-button svg,
      .input-button.outside-end.active-button svg * { fill: #fff !important; }

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
        border: 1px solid #d8dae5;
        border-radius: 8px;
        background-color: #fff;
        color: #333;
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23555' d='M4 6l4 4 4-4z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
        background-size: 14px;
      }
      .command-picker:focus { outline: none; border-color: #1e87f0; box-shadow: 0 0 0 2px rgba(30,135,240,.15); }

      .command-picker.is-dark { background-color: #1f2438; border-color: #2a2f4a; color: #e7e9f5; }
      .command-picker.is-dark ~ * , .is-dark-input #input { }
      #input.is-dark { background-color: #131624; border-color: #2b3049; }
    `;

    // The toolbar is built after the component upgrades, so wait for the send button rather than
    // assuming it is there; give up quietly and leave the select where it is if it never appears.
    let tries = 0;
    const place = () => {
      const sr = el.shadowRoot;
      const submit = sr && sr.querySelector('.input-button.inside-end, .input-button.outside-end');
      if (!submit) {
        if (tries += 1, tries < 60) return setTimeout(place, 100);
        return;
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

      // Dark mode is applied on <html>, which the shadow root cannot see, so it is mirrored on.
      const inputRow = sr.querySelector('#input');
      const syncTheme = () => {
        const dark = document.documentElement.classList.contains('dark');
        picker.classList.toggle('is-dark', dark);
        if (inputRow) inputRow.classList.toggle('is-dark', dark);
      };
      syncTheme();
      new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    };
    place();
  }
  el.errorMessages = { displayServiceErrorMessages: true };
})();

// The actions rail collapses to its icons. The choice is remembered, because a rail that reopens
// on every navigation is one you close on every page.
(function initActionsRail() {
  const rail = document.getElementById('actions-rail');
  if (!rail) return;
  const toggle = rail.querySelector('.actions-toggle');
  const apply = (collapsed) => {
    document.documentElement.classList.toggle('actions-collapsed', collapsed);
    if (toggle) toggle.setAttribute('aria-expanded', String(!collapsed));
  };
  apply(localStorage.getItem('ws-actions-collapsed') === '1');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const collapsed = !document.documentElement.classList.contains('actions-collapsed');
      localStorage.setItem('ws-actions-collapsed', collapsed ? '1' : '0');
      apply(collapsed);
    });
  }
})();

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

/* ---------------- job toasts ------------------------------------------- */

// A job is started from a page but does not belong to it: a build takes minutes and you should be
// able to go and look at something else meanwhile. Every job element is moved into a fixed stack
// the first time it appears, and because the element polls and replaces ITSELF, every later poll
// lands wherever it now lives rather than back in the page it came from.
function jobStack() { return document.getElementById('job-toasts'); }

// Collapsed state is kept on the STACK, not the toast: the toast is replaced by its own poll
// every second, so anything stored on it is gone a second later.
function collapsedJobs() {
  const st = jobStack();
  return new Set(((st && st.dataset.collapsed) || '').split(' ').filter(Boolean));
}
function saveCollapsedJobs(set) {
  const st = jobStack();
  if (st) st.dataset.collapsed = [...set].join(' ');
}

// A dragged size, like the collapsed state, lives on the STACK rather than on the toast: the
// toast element is replaced by its own poll every second, so anything stored on it is gone a
// second later — which is why a resized job used to snap back to its default width.
function toastSizes() {
  const st = jobStack();
  if (!st) return {};
  try { return JSON.parse(st.dataset.sizes || '{}'); } catch (_) { return {}; }
}
function setToastSize(id, w, h) {
  const st = jobStack();
  if (!st) return;
  const all = toastSizes();
  all[id] = { w: Math.round(w), h: Math.round(h) };
  st.dataset.sizes = JSON.stringify(all);
}

// CSS `resize` only ever gives ONE handle, at the bottom right. These are the eight grips a
// resizable panel is expected to have — four corners and four edges — added by hand for that
// reason. Which edge stays put is fixed by the layout: the stack is bottom-anchored and
// right-aligned, so a toast always grows leftwards and upwards. Dragging outward from any grip
// makes it bigger, dragging inward makes it smaller.
const TOAST_GRIPS = {
  tl: { x: -1, y: -1, label: 'top-left corner' },
  t:  { x:  0, y: -1, label: 'top edge' },
  tr: { x:  1, y: -1, label: 'top-right corner' },
  r:  { x:  1, y:  0, label: 'right edge' },
  br: { x:  1, y:  1, label: 'bottom-right corner' },
  b:  { x:  0, y:  1, label: 'bottom edge' },
  bl: { x: -1, y:  1, label: 'bottom-left corner' },
  l:  { x: -1, y:  0, label: 'left edge' },
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

document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest && e.target.closest('.toast-grip');
  if (!grip) return;
  const toast = grip.closest('.job-toast');
  const dir = TOAST_GRIPS[grip.dataset.grip];
  if (!toast || !dir) return;
  e.preventDefault();
  const box = toast.getBoundingClientRect();
  const startX = e.clientX;
  const startY = e.clientY;
  const min = { w: 16 * 16, h: 5 * 16 };
  // The room actually available, not the stack. The stack used to size itself and every toast
  // filled it, so dragging wider did nothing past 34rem — the clamp was the container it lives in
  // rather than the space on screen. Measured from the stack's right edge to a margin on the left,
  // which keeps it clear of the scrollbar that innerWidth would have counted as usable width.
  const stackRight = toast.parentElement.getBoundingClientRect().right;
  const max = { w: Math.max(min.w, stackRight - 16), h: window.innerHeight - 96 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // The toast replaces ITSELF every second while the job runs, so the element under the pointer
  // is gone within a second of grabbing it. Everything below works from the id and re-queries the
  // live element, and the size is written to the store on every move — which is what makes the
  // drag survive a poll landing in the middle of it.
  const id = toast.id;
  const move = (ev) => {
    // An outward drag is positive on every grip: the sign per axis comes from which side of the
    // toast the grip is on. A `0` axis is an edge grip — that dimension is fixed.
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

function adoptJobToasts(root) {
  const stack = jobStack();
  if (!stack) return;
  const collapsed = collapsedJobs();
  // A running toast replaces ITSELF every second, and htmx reports that swap with the toast as
  // the target — so a plain querySelectorAll, which only sees descendants, never finds it and the
  // replacement loses its grips, its size and its collapsed state within a second of getting them.
  const scope = root || document;
  const found = [...scope.querySelectorAll('.job-toast')];
  if (scope.classList && scope.classList.contains('job-toast')) found.push(scope);
  found.forEach((toast) => {
    if (toast.parentElement !== stack) stack.appendChild(toast);
    addToastGrips(toast);
    const size = toastSizes()[toast.id];
    if (size) { toast.style.width = `${size.w}px`; toast.style.height = `${size.h}px`; }
    const isC = collapsed.has(toast.id);
    toast.classList.toggle('is-collapsed', isC);
    const btn = toast.querySelector('.job-toast-collapse');
    if (btn) btn.setAttribute('aria-expanded', String(!isC));
  });
}

document.addEventListener('DOMContentLoaded', () => adoptJobToasts());
document.body.addEventListener('htmx:afterSwap', (e) => adoptJobToasts(e.target));

document.addEventListener('click', (e) => {
  const collapse = e.target.closest && e.target.closest('.job-toast-collapse');
  if (collapse) {
    const toast = collapse.closest('.job-toast');
    const set = collapsedJobs();
    const now = !toast.classList.contains('is-collapsed');
    toast.classList.toggle('is-collapsed', now);
    collapse.setAttribute('aria-expanded', String(!now));
    if (now) set.add(toast.id); else set.delete(toast.id);
    saveCollapsedJobs(set);
    return;
  }
  // Dismiss removes the toast, not the job: a running build carries on, and the stack picks it up
  // again on the next page load.
  const close = e.target.closest && e.target.closest('.job-toast-close');
  if (close) {
    const toast = close.closest('.job-toast');
    const set = collapsedJobs();
    set.delete(toast.id);
    saveCollapsedJobs(set);
    toast.remove();
  }
});

// Run a prompt: fetch its text and put it in the assistant, rather than firing it. These prompts
// carry placeholders — a project name, a version — so the useful thing is to arrive at a filled-in
// prompt box with the cursor in it, not to send something with <project> still in it.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest && e.target.closest('.run-prompt');
  if (!btn) return;
  e.preventDefault();
  const res = await fetch(`/files/${btn.dataset.workspace}/${encodeURIComponent(btn.dataset.name)}.md`);
  if (!res.ok) return;
  const text = await res.text();
  const el = document.getElementById('ws-deep-chat');
  const input = el && el.shadowRoot && el.shadowRoot.querySelector('#text-input');
  if (!input) return;
  input.innerText = text.trim();
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
});

// UIKit fires `moved` when a sortable item is dropped. The card grid posts the order it ended up
// in — and the order it was rendered from, so the server can refuse a save that would land on top
// of someone else's edit.
document.body.addEventListener('moved', (e) => {
  const grid = e.target.closest && e.target.closest('#workspace-cards');
  if (!grid || !window.htmx) return;
  const order = [...grid.querySelectorAll('.ws-card-wrap')].map((el) => el.dataset.ws).filter(Boolean);
  window.htmx.ajax('POST', '/actions/list-order', {
    target: '#workspace-cards-wrap',
    swap: 'outerHTML',
    values: {
      order: order.join(','),
      was: grid.dataset.order || '',
      file: grid.dataset.file || 'settings.yml',
      key: grid.dataset.key || 'workspaces',
      view: 'home',
    },
  });
});

// A handle sits on top of a card that is a link: a click on it must not navigate.
document.addEventListener('click', (e) => {
  if (e.target.closest && e.target.closest('.ws-card-handle')) { e.preventDefault(); e.stopPropagation(); }
}, true);

/* ---------------- the code editor (Ace) --------------------------------- */

// Ace (ajaxorg/ace, BSD-3, vendored) for the files that are code — the items in the file
// workspaces are Markdown with a YAML frontmatter block, and a plain textarea gives you no
// structure at all in a 200-line agent definition.
//
// It ATTACHES to a textarea marked data-ace="<mode>" and writes every change straight back into
// it, so the form still posts the same field and no endpoint changed. If Ace fails to load, the
// textarea is simply still there and still works — which is why this replaces rather than removes
// it, and why the whole thing is wrapped in a catch that does nothing.
//
// Loaded on demand: half a megabyte of editor has no business on a page that is not editing.
let acePromise = null;
function loadAce() {
  if (acePromise) return acePromise;
  acePromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = '/vendor/ace/ace.js';
    el.onload = () => {
      // Ace resolves its own mode and theme files from basePath. Only the vendored subset is
      // there, so nothing may ask for a file that was not shipped.
      window.ace.config.set('basePath', '/vendor/ace');
      resolve(window.ace);
    };
    el.onerror = reject;
    document.head.appendChild(el);
  });
  return acePromise;
}

// The vendored mode-markdown.js defines the shell and HTML modes inline as well, so these three
// cost one file between them.
const ACE_MODES = { md: 'markdown', markdown: 'markdown', sh: 'sh', bash: 'sh' };

function aceTheme() {
  // settings.yml's style.editor_theme can pin the editor independently of the page: 'auto' follows
  // it, 'light' and 'dark' force it — a code editor is one place people want dark on a light page.
  const forced = document.documentElement.dataset.editorTheme;
  const dark = forced === 'dark' ? true
    : forced === 'light' ? false
    : document.documentElement.classList.contains('dark');
  return dark ? 'ace/theme/tomorrow_night' : 'ace/theme/textmate';
}

function attachAce(root) {
  const scope = root && root.querySelectorAll ? root : document;
  // The scope element itself may BE the textarea's container after an htmx swap, so it is included
  // rather than only its descendants — the same trap the job toasts fell into.
  const fields = [...scope.querySelectorAll('textarea[data-ace]:not([data-ace-ready])')];
  if (scope.matches && scope.matches('textarea[data-ace]:not([data-ace-ready])')) fields.push(scope);
  if (!fields.length) return;
  loadAce().then((ace) => {
    fields.forEach((ta) => {
      if (ta.dataset.aceReady) return;
      ta.dataset.aceReady = '1';
      const host = document.createElement('div');
      host.className = 'ace-host';
      // Sized from the textarea it replaces, so the form keeps the shape it had, within bounds
      // that keep a long document from pushing Save off the screen.
      host.style.height = `${Math.max(280, Math.min(640, (ta.rows || 16) * 21))}px`;
      ta.parentNode.insertBefore(host, ta);
      ta.style.display = 'none';               // kept in the DOM: it is what submits

      const editor = ace.edit(host);
      editor.session.setMode(`ace/mode/${ACE_MODES[ta.dataset.ace] || 'markdown'}`);
      editor.setTheme(aceTheme());
      editor.session.setValue(ta.value);
      editor.session.setUseSoftTabs(true);
      editor.session.setTabSize(2);
      editor.session.setUseWrapMode(true);     // prose wraps; a Markdown paragraph is one line
      editor.setShowPrintMargin(false);
      editor.setOption('useWorker', false);    // no worker file is vendored
      editor.session.on('change', () => { ta.value = editor.session.getValue(); });
      ta._aceEditor = editor;
    });
  }).catch(() => { /* no Ace: the textarea is still there and still works */ });
}

document.addEventListener('DOMContentLoaded', () => attachAce());
document.body.addEventListener('htmx:afterSwap', (e) => attachAce(e.target));

// Follow the theme toggle, since the editor paints its own background and would otherwise sit as a
// white slab on a dark page.
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-toggle')) return;
  setTimeout(() => {
    document.querySelectorAll('textarea[data-ace-ready]').forEach((ta) => {
      if (ta._aceEditor) ta._aceEditor.setTheme(aceTheme());
    });
  }, 50);
});

/* ---------------- result toasts ----------------------------------------- */

// A short result becomes a toast at the top.
//
// "✅ Saved", "🗑️ Deleted", "that name is taken" used to render wherever the form happened to be —
// which on the settings page is below sixty fields and off the screen, so a save looked like it had
// done nothing. A job keeps its own stack at the bottom because that is something you WATCH; this
// is something you read once and forget, so it leaves on its own.
const FLASH_MS = { ok: 6000, error: 12000 };   // an error is left up long enough to actually read

function flashResults(root) {
  const stack = document.getElementById('flash-toasts');
  if (!stack) return;
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('.msg:not(.flash-toast)').forEach((msg) => {
    // The chat log, a job's own output and anything already promoted stay where they are: those
    // are content or a running thing to watch, not a result to read once.
    if (msg.closest('.chat-log') || msg.closest('#flash-toasts') || msg.closest('.job-toast')
        || msg.closest('#editor-modal')) return;
    if (!msg.textContent.trim()) return;

    msg.classList.add('flash-toast');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'flash-toast-close';
    close.title = 'Dismiss';
    close.setAttribute('aria-label', 'Dismiss');
    close.innerHTML = '<span uk-icon="icon: close; ratio: .7"></span>';
    msg.appendChild(close);
    stack.appendChild(msg);

    const ms = msg.classList.contains('error') ? FLASH_MS.error : FLASH_MS.ok;
    // The countdown bar animates from this, so what you see and what the timer does are one number.
    msg.style.setProperty('--flash-ms', `${ms}ms`);
    let timer = setTimeout(() => msg.remove(), ms);
    // Reading a long message must not race its own timer.
    msg.addEventListener('mouseenter', () => { clearTimeout(timer); msg.classList.add('is-held'); });
    msg.addEventListener('mouseleave', () => {
      msg.classList.remove('is-held');
      timer = setTimeout(() => msg.remove(), 2500);
    });
  });
}

document.body.addEventListener('htmx:afterSwap', (e) => flashResults(e.target));
// An outerHTML swap REPLACES the element the event names, so the new message can land outside
// e.target and never reach the stack — that is why a saved card order sometimes showed nothing at
// all. A document-wide pass once htmx has settled catches it, and promoting is idempotent, so the
// two cannot double up.
document.body.addEventListener('htmx:afterSettle', () => flashResults(document));

document.addEventListener('click', (e) => {
  const close = e.target.closest && e.target.closest('.flash-toast-close');
  if (close) close.closest('.flash-toast').remove();
});

// htmx swaps only 2xx by default, so every message the server sent WITH a failure status — "that
// item is gone", "not a DDEV project", "already exists, remove it first" — was thrown away, and
// the click looked like it had simply done nothing. The response is the explanation; show it.
document.body.addEventListener('htmx:beforeSwap', (e) => {
  const status = e.detail.xhr && e.detail.xhr.status;
  if (status >= 400 && status < 600) e.detail.shouldSwap = true;
});

/* ---------------- the one modal ----------------------------------------- */

// Anything you OPEN — an editor, a video, a test report, a generator form — lands in one dialog.
// It is shown when the CONTENT ARRIVES rather than on the click: opening first would flash an
// empty dialog for as long as the fetch takes, which on a big document is long enough to see.
document.body.addEventListener('htmx:afterSwap', (e) => {
  if (e.target && e.target.id === 'editor-modal-body' && window.UIkit) {
    // Close whatever menu opened it first. A UIkit dropdown only closes on an outside click, and
    // a click inside it is not one — so the menu stayed up, floating over the dialog it had just
    // opened, and its items sat on top of the content.
    document.querySelectorAll('.uk-dropdown.uk-open').forEach((d) => {
      try { window.UIkit.dropdown(d).hide(false); } catch (_) { /* already gone */ }
    });
    window.UIkit.modal('#editor-modal').show();
  }
});

// A save is the end of the dialog: the list behind it refreshes itself from the same response's
// HX-Trigger, and the confirmation is a toast at the top, so there is nothing left to keep open.
document.body.addEventListener('htmx:afterRequest', (e) => {
  const inModal = e.target && e.target.closest && e.target.closest('#editor-modal-body');
  const ok = e.detail && e.detail.xhr && e.detail.xhr.status >= 200 && e.detail.xhr.status < 300;
  const saved = e.detail && e.detail.requestConfig && /\/actions\/(save-item|generate-item|save-doc)/.test(e.detail.requestConfig.path || '');
  if (inModal && ok && saved && window.UIkit) window.UIkit.modal('#editor-modal').hide();
});

// A video left playing behind a closed dialog is a voice in an empty room.
document.addEventListener('beforehide', (e) => {
  if (!e.target || e.target.id !== 'editor-modal') return;
  e.target.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); } catch (_) { /* gone */ } });
});
