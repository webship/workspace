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
/** One completion offered after @ or / : an item of the workspace, and where it is. */
interface Mention { name: string; kind: string; where: string; description?: string }
/** A textarea an Ace editor stands in for: it keeps the value the form submits, and its editor. */
type AceTextarea = HTMLTextAreaElement & { _aceEditor?: AceEditor };

const _mentionCache = new Map<string, Promise<unknown>>();
function mentionsFor(url: string) {
  if (!_mentionCache.has(url)) {
    _mentionCache.set(url, fetch(url).then((r) => r.json()).catch(() => []));
  }
  return _mentionCache.get(url);
}

function attachMentions(ace: AceApi, editor: AceEditor, url: string) {
  let tools: ReturnType<AceApi['require']>;
  try { tools = ace.require('ace/ext/language_tools'); } catch (_) { return; }
  if (!tools) return;
  editor.setOptions({ enableBasicAutocompletion: true, enableLiveAutocompletion: true });
  // The same endpoint and the same rules as the composer's popup (suggest.js), so the two
  // fields cannot offer different things: "@" for agents and skills, "/" for commands and
  // skills. It used to be "@" only, and it inserted `@"name (kind)"` — a shape neither the
  // CLI nor the assistant understands, so what you picked was not what you could send.
  let items: Record<string, Mention[]> = { '@': [], '/': [] };
  const load = (trigger: string) => fetch(`${url}${url.includes('?') ? '&' : '?'}trigger=${encodeURIComponent(trigger)}`,
    { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : []))
    .then((list: Mention[] | null) => { items[trigger] = list || []; })
    .catch(() => { /* no completions; the editor still edits */ });
  load('@');
  load('/');
  tools.addCompleter({
    // Only after a trigger — this is a prompt field, not a code editor, and suggesting on
    // every word would fight the typing.
    identifierRegexps: [/[@/a-zA-Z0-9_.-]/],
    getCompletions(ed, session, pos, prefix, callback) {
      const line = session.getLine(pos.row).slice(0, pos.column);
      let best: { trigger: string; at: number; typed: string } | null = null;
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
      const found = best;
      const hits = (items[found.trigger] || [])
        .filter((m) => m.name.toLowerCase().includes(found.typed))
        .slice(0, 40)
        .map((m, _i, arr) => ({
          // The trigger and the name — plus the kind when the name alone is ambiguous.
          // A few items exist as both an agent and a skill and are not interchangeable.
          caption: `${found.trigger}${m.name}${arr.filter((o) => o.name === m.name).length > 1 ? ` (${m.kind})` : ''}`,
          value: `${found.trigger}${m.name}${arr.filter((o) => o.name === m.name).length > 1 ? ` (${m.kind})` : ''}`,
          meta: `${m.kind} · ${m.where}`,
          docHTML: m.description
            ? `<div style="max-width:38rem;white-space:normal">${m.description.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]!)}</div>`
            : undefined,
          score: m.where === 'this project' ? 1000 : m.where === 'installed' ? 500 : 100,
        }));
      callback(null, hits);
    },
  });
}

let acePromise: Promise<AceApi> | null = null;
function loadAce() {
  if (acePromise) return acePromise;
  acePromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = '/vendor/ace/ace.js';
    el.onload = () => {
      window.ace!.config.set('basePath', '/vendor/ace');
      // Ace resolves worker and mode files itself from basePath; only the yaml worker
      // is vendored, so the others must not be reached for.
      window.ace!.config.setModuleUrl('ace/mode/yaml_worker', '/vendor/ace/worker-yaml.js');
      // The completion extension is part of loading Ace, not a race beside it:
      // an editor that mounts first would find no completer to register with.
      const lt = document.createElement('script');
      lt.src = '/vendor/ace/ext-language_tools.js';
      lt.onload = () => resolve(window.ace!);
      lt.onerror = () => resolve(window.ace!);   // no completions, still an editor
      document.head.appendChild(lt);
    };
    el.onerror = reject;
    document.head.appendChild(el);
  });
  return acePromise;
}

const ACE_MODES: Record<string, string> = { sh: 'sh', yaml: 'yaml', yml: 'yaml', markdown: 'markdown', md: 'markdown' };

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

function attachAce(root?: ParentNode | null) {
  // A swap can name a target that is not an element (a polling card replaces itself); there is nothing to attach to then.
  if (root && typeof root.querySelectorAll !== 'function') return;
  const fields = (root && typeof root.querySelectorAll === 'function' ? root : document).querySelectorAll<AceTextarea>('textarea[data-ace]:not([data-ace-ready])');
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
      const mode = ACE_MODES[ta.dataset.ace || ''] || 'sh';
      // data-ace-single: one line (a command line) — no Enter, no gutter, and a pasted line break becomes a space.
      // readonly: code shown on a page, to read and copy, not to type into.
      const single = ta.dataset.aceSingle === '1';
      const readOnly = ta.readOnly || ta.dataset.aceReadonly === '1';
      const host = document.createElement('div');
      host.className = `ace-host${single ? ' ace-host-single' : ''}${readOnly ? ' ace-host-readonly' : ''}`;
      // A short field (a prompt, a few steps) gets a short editor: the 260px
      // floor is for the file editors, not for a form row. A one-line editor sizes itself.
      if (!single) host.style.height = `${ta.rows <= 8 ? Math.max(90, ta.rows * 19) : Math.max(260, Math.min(620, ta.rows * 19))}px`;
      ta.parentNode!.insertBefore(host, ta);
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
  if (!e.target || (e.target as Element).id !== 'row-actions-editor') return;
  if (window.UIkit && document.querySelector('#editor-modal.uk-open')) window.UIkit.modal('#editor-modal').hide();
});

document.addEventListener('DOMContentLoaded', () => attachAce());
// Start AI's prompt gets Ace only once Start AI is ticked, so a workspace page does not load the editor for nothing.
document.addEventListener('change', (e) => {
  const box = e.target && (e.target as Element).matches && (e.target as Element).matches('input[name="ai_after"]') ? e.target as HTMLInputElement : null;
  if (!box || !box.checked) return;
  const form = box.closest('form');
  const ta = form && form.querySelector<HTMLTextAreaElement>('textarea[data-ace-on-demand]:not([data-ace])');
  if (!ta) return;
  ta.dataset.ace = ta.dataset.aceOnDemand;
  attachAce(form);
});
document.body.addEventListener('htmx:after:swap', (e) => attachAce(swappedEl(e)));
document.body.addEventListener('htmx:after:settle', (e) => attachAce(swappedEl(e)));

// Follow the theme toggle, since the editor paints its own background.
document.addEventListener('click', (e) => {
  if (!(e.target as Element).closest('.theme-toggle')) return;
  setTimeout(() => {
    document.querySelectorAll<AceTextarea>('textarea[data-ace-ready]').forEach((ta) => {
      if (ta._aceEditor) ta._aceEditor.setTheme(aceTheme());
    });
  }, 50);
});

// A project's list of addresses, from nine on, has a filter at its top (server.js): the host names narrow
// as you type, the line under the box says what is left, Escape empties the box before it closes the list,
// and the box takes focus when the list opens, so a keyboard goes straight to it.
document.addEventListener('input', (e) => {
  const box = (e.target as Element).closest && (e.target as Element).closest<HTMLInputElement>('.pcard-domains-filter');
  if (!box) return;
  const list = box.closest('.pcard-domains')!;
  const q = box.value.trim().toLowerCase();
  const items = [...list.querySelectorAll('li')].filter((li) => li.querySelector('.host'));
  let shown = 0;
  items.forEach((li) => {
    const hit = !q || li.querySelector('.host')!.textContent!.toLowerCase().includes(q);
    li.hidden = !hit;
    if (hit) shown += 1;
  });
  const status = list.querySelector('.pcard-domains-status');
  if (status) status.textContent = !q ? '' : shown ? `${shown} of ${items.length} shown.` : 'Nothing matches.';
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const box = (e.target as Element).closest && (e.target as Element).closest<HTMLInputElement>('.pcard-domains-filter');
  if (!box || !box.value) return;
  e.preventDefault();
  e.stopPropagation();
  box.value = '';
  box.dispatchEvent(new Event('input', { bubbles: true }));
}, true);
document.addEventListener('shown', (e) => {
  const t = e.target as Element | null;
  const box = t && t.classList && t.classList.contains('pcard-domains') && t.querySelector<HTMLInputElement>('.pcard-domains-filter');
  if (box) box.focus();
});
// UIkit marks every dropdown's toggle aria-haspopup="true", which is a menu button. The "+N" of a project's
// addresses opens a filter and a list of links, not a menu: it is a disclosure, aria-expanded (UIkit keeps
// it) and aria-controls (server.js). UIkit sets the attribute when it connects the dropdown, before or after
// this runs, on load and after every swap, so it is taken off whenever it is set.
(function addressListIsADisclosure() {
  const strip = (el: Element) => {
    if (el.matches && el.matches('.pcard-count[aria-controls]') && el.hasAttribute('aria-haspopup')) el.removeAttribute('aria-haspopup');
  };
  document.querySelectorAll('.pcard-count[aria-controls]').forEach(strip);
  new MutationObserver((records) => records.forEach((r) => strip(r.target as Element)))
    .observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['aria-haspopup'] });
})();

