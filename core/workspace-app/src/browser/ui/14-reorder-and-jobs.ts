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
  const item = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.ws-item');
  if (!item) return;
  item.classList.add('is-dragging');
  e.dataTransfer!.effectAllowed = 'move';
  e.dataTransfer!.setData('text/plain', item.dataset.ws || '');
});

document.addEventListener('dragover', (e) => {
  const list = (e.target as Element).closest && (e.target as Element).closest('.ws-list');
  if (!list) return;
  e.preventDefault();
  const dragging = list.querySelector('.ws-item.is-dragging');
  const over = (e.target as Element).closest('.ws-item');
  if (!dragging || !over || over === dragging) return;
  const box = over.getBoundingClientRect();
  const after = e.clientY > box.top + box.height / 2;
  list.insertBefore(dragging, after ? over.nextSibling : over);
});

document.addEventListener('dragend', (e) => {
  const item = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>('.ws-item');
  if (!item) return;
  item.classList.remove('is-dragging');
  const editor = item.closest<HTMLElement>('#list-editor');
  const list = item.closest('.ws-list');
  if (!editor || !list) return;
  const order = [...list.querySelectorAll<HTMLElement>('.ws-item')].map((li) => li.dataset.ws).join(',');
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
  const d: { open?: string; navigate?: string } = (e as CustomEvent).detail || {};
  if (d.open) window.open(d.open, '_blank', 'noopener');
  if (d.navigate) setTimeout(() => { location.href = d.navigate!; }, 900);
});

// Global "system is working" indicator: count in-flight HTMX requests and
// toggle html.htmx-busy, which shows the top progress bar + Working… pill.
let activeRequests = 0;
const isJobPoll = (e: Event) => (e as CustomEvent<{ elt?: Element } | null>).detail?.elt?.id?.startsWith('job-');
document.addEventListener('htmx:before:request', (e) => {
  if (isJobPoll(e)) return; // 1s job polls would make the bar flicker forever
  activeRequests += 1;
  document.documentElement.classList.add('htmx-busy');
});
const requestDone = (e: Event) => {
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
  const el = swappedEl(e)!;
  const pres: HTMLElement[] = [];
  if (el.classList?.contains('terminal')) pres.push(...el.querySelectorAll<HTMLElement>('.terminal-pre'));
  el.querySelectorAll?.<HTMLElement>('.terminal .terminal-pre').forEach((p) => pres.push(p));
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
  if (!(e.target as Element).closest('.theme-toggle')) return;
  const dark = document.documentElement.classList.toggle('dark');
  wsPrefSet('ws-theme', dark ? 'dark' : 'light');
});

// The command picker inside the prompt: choosing an entry writes a runnable
// phrase into the box and hands focus back, so the prompt stays the one place
// you type. It never runs anything by itself.
document.addEventListener('change', (e) => {
  const picker = (e.target as Element).closest<HTMLSelectElement>('.command-picker');
  if (!picker || !picker.value) return;
  const form = picker.closest('form');
  const input = form && form.querySelector<HTMLInputElement>('input[name="message"]');
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
  const hit = (cls: string) => path.find((n) => n && (n as Element).classList && (n as Element).classList.contains(cls));
  const run = hit('plan-run');
  const keep = hit('plan-keep');
  if (!run && !keep) return;
  const chat = document.getElementById('ws-deep-chat') as (HTMLElement & { submitUserMessage(message: unknown): void }) | null;
  if (!chat) return;
  if (keep) {
    const input = chat.shadowRoot && chat.shadowRoot.querySelector<HTMLElement>('#text-input');
    if (input) input.focus();
    return;
  }
  const card = path.find((n) => n && (n as Element).classList && (n as Element).classList.contains('plan-card')) as Element | undefined;
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
  const close = (e.target as Element).closest('.image-choices-close');
  if (close) { close.closest('.image-picker')!.innerHTML = ''; return; }
  const tile = (e.target as Element).closest<HTMLElement>('[data-pick-image]');
  if (!tile) return;
  const field = document.getElementById(tile.dataset.pickTarget!) as HTMLInputElement | null;
  if (!field) return;
  field.value = tile.dataset.pickImage!;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const preview = field.closest('.image-field')?.querySelector('.image-preview');
  if (preview) preview.innerHTML = `<img src="/${tile.dataset.pickImage}" alt="">`;
  tile.closest('.image-picker')!.innerHTML = '';
  field.focus();
});

// The grip lives inside the card, which is a link: a click that lands on it must not navigate.
document.addEventListener('click', (e) => {
  const grip = (e.target as Element).closest('.ws-card-handle');
  if (!grip) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

document.body.addEventListener('htmx:before:swap', (e) => {
  const el = swappedEl(e);
  if (el && el.id === 'editor-modal-body') {
    el.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => { try { m.pause(); } catch (_) { /* gone */ } });
  }
});

// A job view is read in a window, never at the foot of the page. The dashboard's own (the log of a
// session, followed) are asked for by the modal; a plugin that still answers a page button with
// one (api.lib.startJob + jobFragment into #webship-workspace-output) has it moved into the
// modal here. The view replaces ITSELF on every poll, so once moved it stays where it is.
function jobViewsToWindow() {
  const body = document.getElementById('editor-modal-body');
  if (!body) return;
  document.querySelectorAll('#webship-workspace-output .job-view, #settings-output .job-view').forEach((view) => {
    body.replaceChildren(view);
    try { window.UIkit!.modal('#editor-modal').show(); } catch (_) { /* no modal on this page: it stays readable in place */ }
  });
}
document.body.addEventListener('htmx:after:swap', jobViewsToWindow);
