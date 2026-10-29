/**
 * "@" and "/" suggestions in any prompt field, the way the Claude Code CLI offers them.
 *
 * The dashboard already had this in ONE place — the Ace editor on the New screen form,
 * "@" only — which is the field people use least. The AI Assistant composer, which is on
 * every page, had nothing: you had to know the exact name of an agent or a skill and
 * type it from memory, out of 87 agents and 42 skills.
 *
 * This attaches to a plain <input> or <textarea>, because that is what the composer is:
 * deep-chat owns its own input inside a shadow root, so there is no editor API to hook
 * and no way to reuse Ace's completer. The popup is therefore built from scratch, and
 * kept deliberately small — it is a list, a filter and four keys.
 *
 *   @  agents and skills   — a capability you name
 *   /  commands and skills — something you invoke
 *
 * Prompts are offered by neither: a prompt is a whole `claude …` launch command for a NEW
 * session, so it cannot be dropped into a message that is already running. The New screen
 * form has its own template picker for those.
 *
 * Attach by marking a field:  data-suggest="/fragments/ai-suggest/<workspace>/<project>"
 * (the path may be the bare endpoint), or call attachSuggest(el, url) directly — which is
 * what ui.js does for deep-chat's input once it appears in the shadow DOM.
 */
(function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * Reading and writing the field.
   *
   * Two shapes, one interface. A textarea has .value and .selectionStart; deep-chat's
   * composer is a contenteditable DIV (`#text-input`) with neither, so the caret has to
   * come from the Selection API and be restored by building a Range. Everything below
   * this line works in characters and never touches either directly — which is what let
   * the same popup serve the New screen form and the assistant.
   * ------------------------------------------------------------------------ */

  const isCE = (el) => !('value' in el) && el.isContentEditable;

  /** Caret offset in characters from the start of a contenteditable's text. */
  function ceCaret(el) {
    const sel = (el.ownerDocument.defaultView || window).getSelection
      ? (el.getRootNode().getSelection ? el.getRootNode().getSelection() : window.getSelection())
      : null;
    if (!sel || sel.rangeCount === 0) return el.textContent.length;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return el.textContent.length;
    const probe = range.cloneRange();
    probe.selectNodeContents(el);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length;
  }

  /** Put the caret at a character offset, walking the text nodes to find it. */
  function ceSetCaret(el, offset) {
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let seen = 0;
    let node = walker.nextNode();
    while (node) {
      const len = node.nodeValue.length;
      if (seen + len >= offset) {
        const range = doc.createRange();
        range.setStart(node, Math.max(0, offset - seen));
        range.collapse(true);
        const sel = el.getRootNode().getSelection ? el.getRootNode().getSelection() : window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        return;
      }
      seen += len;
      node = walker.nextNode();
    }
    // Past the end (an empty field): collapse into the element itself.
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = el.getRootNode().getSelection ? el.getRootNode().getSelection() : window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }

  function readField(el) {
    if (isCE(el)) return { value: el.textContent || '', caret: ceCaret(el) };
    const value = el.value || '';
    return { value, caret: el.selectionStart == null ? value.length : el.selectionStart };
  }

  function writeField(el, value, caret) {
    if (isCE(el)) {
      el.textContent = value;
      ceSetCaret(el, caret);
      return;
    }
    el.value = value;
    try { el.setSelectionRange(caret, caret); } catch (_) { /* not all inputs allow it */ }
  }

  const OPEN_CLASS = 'ws-suggest-open';
  const TRIGGERS = ['@', '/'];

  // One fetch per (url, trigger, query), briefly. A keystroke is a request otherwise, and
  // the server memoises for five seconds anyway — this keeps the typing from queueing.
  const cache = new Map();
  const CACHE_TTL = 4000;

  async function fetchItems(url, trigger, typed) {
    const key = `${url}|${trigger}|${typed}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;
    const qs = `trigger=${encodeURIComponent(trigger)}&q=${encodeURIComponent(typed)}`;
    try {
      const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}${qs}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const items = await res.json();
      cache.set(key, { at: Date.now(), items });
      return items;
    } catch (_) {
      return [];   // offline, or the endpoint is gone: the field still types
    }
  }

  /**
   * What the caret is currently asking for, or null.
   *
   * A trigger only counts at the START of a word — after nothing, or after whitespace.
   * Without that rule an email address opens the agent list on every "@", and a file path
   * opens the command list on every "/". Once a space is typed the token is finished and
   * the popup closes, which is also how the CLI behaves.
   */
  function tokenAt(value, caret) {
    const upto = value.slice(0, caret);
    for (const trigger of TRIGGERS) {
      const at = upto.lastIndexOf(trigger);
      if (at === -1) continue;
      const before = at === 0 ? '' : upto[at - 1];
      if (before && !/\s/.test(before)) continue;
      const typed = upto.slice(at + 1);
      // A finished token, or something that is plainly not a name.
      if (/[\s"']/.test(typed)) continue;
      // `/` is a command only at the very start of the message, exactly like the CLI:
      // otherwise every date and path in a sentence would open the list.
      if (trigger === '/' && at !== 0 && !/^\s*$/.test(upto.slice(0, at))) continue;
      return { trigger, at, typed };
    }
    return null;
  }

  // The vendored Tabler sprite, not emoji. The first version used 🤖 📎 ⌘ and they render
  // as TOFU BOXES wherever no emoji font is installed — which includes the headless
  // chromium these screenshots come from, and any server-side render. The dashboard
  // already ships public/vendor/tabler-sprite.svg and paints it through .tabler-icon, so
  // these inherit the same stroke and brand colour as every other icon on the page.
  const KIND_ICON = { agent: 'robot', skill: 'paperclip', command: 'command' };
  const iconSvg = (kind) => `<svg class="tabler-icon" width="15" height="15" aria-hidden="true">`
    + `<use href="/vendor/tabler-sprite.svg#${KIND_ICON[kind] || 'point'}"></use></svg>`;

  function popupFor(el) {
    if (el._wsSuggestBox) return el._wsSuggestBox;
    const box = document.createElement('div');
    box.className = 'ws-suggest';
    box.setAttribute('role', 'listbox');
    box.hidden = true;
    // On <body> rather than beside the field: the composer's input lives inside
    // deep-chat's shadow root, and a popup appended there inherits that component's own
    // overflow and stacking. Positioned absolutely against the field's rect instead.
    document.body.appendChild(box);
    el._wsSuggestBox = box;
    return box;
  }

  // Wide enough for the longest name there is. They run to 47 characters
  // (`upsun-varbase-sandbox-1-playground-3-demo-reset`,
  // `vardot-site-launch-pre-deployment-checklist-dev`) and an ambiguous one carries a
  // ` (agent)` qualifier on top — around 56 monospace characters, which no 400px
  // assistant rail can show. The popup is therefore allowed to be WIDER THAN THE FIELD
  // it belongs to: the name is the thing being chosen, so truncating it defeats the
  // list. Bounded by the viewport, and never narrower than the field.
  const MIN_WIDTH = 560;
  const MAX_WIDTH = 780;

  function place(box, el) {
    const r = el.getBoundingClientRect();
    const room = window.innerWidth - 24;
    const width = Math.min(Math.max(MIN_WIDTH, r.width), MAX_WIDTH, room);
    box.style.width = `${width}px`;
    // Aligned to the field, but pulled back inside the viewport when that would overflow
    // — the rail sits on the right, so a wider-than-field popup would run off the edge.
    box.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`;
    // Above the field when there is not enough room below — a composer sits at the bottom
    // of its panel, so below is usually the wrong side.
    const below = window.innerHeight - r.bottom;
    const wanted = Math.min(320, box.scrollHeight || 320);
    if (below < wanted + 16 && r.top > below) {
      box.style.top = `${Math.max(8, r.top - wanted - 6)}px`;
      box.style.maxHeight = `${Math.min(wanted, r.top - 16)}px`;
    } else {
      box.style.top = `${r.bottom + 6}px`;
      box.style.maxHeight = `${Math.max(120, below - 16)}px`;
    }
  }

  function attachSuggest(el, url) {
    if (!el || el._wsSuggest) return;
    el._wsSuggest = true;
    const box = popupFor(el);
    let items = [];
    let active = 0;
    let token = null;

    const close = () => {
      box.hidden = true;
      box.classList.remove(OPEN_CLASS);
      token = null;
      items = [];
      el.removeAttribute('aria-activedescendant');
    };

    const render = () => {
      if (!items.length) return close();
      box.innerHTML = items.map((it, i) => `
        <div class="ws-suggest-row${i === active ? ' is-active' : ''}" role="option"
             id="ws-suggest-${i}" aria-selected="${i === active}" data-i="${i}">
          <span class="ws-suggest-icon">${iconSvg(it.kind)}</span>
          <span class="ws-suggest-name">${token.trigger}${escapeHtml(it.name)}</span>
          <span class="ws-suggest-kind">${escapeHtml(it.kind)}</span>
          <span class="ws-suggest-where">${escapeHtml(it.where)}</span>
          <div class="ws-suggest-desc">${escapeHtml(it.description || '')}</div>
        </div>`).join('');
      box.hidden = false;
      box.classList.add(OPEN_CLASS);
      place(box, el);
      const activeRow = box.querySelector('.is-active');
      if (activeRow) activeRow.scrollIntoView({ block: 'nearest' });
      el.setAttribute('aria-activedescendant', `ws-suggest-${active}`);
    };

    const insert = (it) => {
      if (!token) return;
      const { value, caret } = readField(el);
      // A name can carry no space, so nothing needs quoting: the token is replaced with
      // the trigger and the name, then one space so the next word starts cleanly.
      const before = value.slice(0, token.at);
      const after = value.slice(caret);
      // The kind is kept ONLY when the name needs it. Several items exist as both an
      // agent and a skill — varbase-demo-video-manager and vardot-penpot-designer among
      // them — and they are not interchangeable: the agent drives a whole job, the skill
      // carries the steps. `@varbase-demo-video-manager` alone does not say which, so an
      // ambiguous name is inserted as `@name (kind)` and an unambiguous one stays clean.
      const ambiguous = items.filter((o) => o.name === it.name).length > 1;
      const insertion = ambiguous
        ? `${token.trigger}${it.name} (${it.kind}) `
        : `${token.trigger}${it.name} `;
      writeField(el, `${before}${insertion}${after}`, before.length + insertion.length);
      close();
      // deep-chat and any htmx-bound field listen for input, not for assignment.
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.focus();
    };

    const refresh = async () => {
      const { value, caret } = readField(el);
      const t = tokenAt(value, caret);
      if (!t) return close();
      token = t;
      const found = await fetchItems(url, t.trigger, t.typed);
      // The field may have moved on while the request was in flight.
      const now = readField(el);
      const still = tokenAt(now.value, now.caret);
      if (!still || still.trigger !== t.trigger || still.at !== t.at) return;
      token = still;
      items = found;
      active = 0;
      render();
    };

    let timer = null;
    const schedule = () => { clearTimeout(timer); timer = setTimeout(refresh, 90); };
    el.addEventListener('input', schedule);
    // Arrow keys and clicks move the caret without changing the text, which can move it
    // into or out of a token: `@vardot-work|space` should still be offering completions.
    el.addEventListener('keyup', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) schedule();
    });
    el.addEventListener('click', schedule);
    el.addEventListener('blur', () => setTimeout(close, 150));
    el.addEventListener('keydown', (e) => {
      if (box.hidden) return;
      // Keys the popup owns while it is open, and only then — so typing is never captured
      // by a list that is not showing.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
        render();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        // Enter would SEND the message, which is the one thing it must not do while a
        // suggestion is highlighted. stopPropagation as well as preventDefault, because
        // deep-chat's own handler is on an ancestor.
        e.preventDefault();
        e.stopPropagation();
        insert(items[active]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    // Capture: deep-chat's Enter handler is bound on its own container, so a bubbling
    // listener here would run after the message had already been sent.
    }, true);

    box.addEventListener('mousedown', (e) => {
      const row = e.target.closest('.ws-suggest-row');
      if (!row) return;
      e.preventDefault();        // do not blur the field before inserting
      insert(items[Number(row.dataset.i)]);
    });
    window.addEventListener('resize', () => { if (!box.hidden) place(box, el); });
    window.addEventListener('scroll', () => { if (!box.hidden) place(box, el); }, true);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /** Every field that asked for suggestions, including ones arriving in a fragment. */
  function attachAll(root) {
    (root || document).querySelectorAll('[data-suggest]').forEach((el) => {
      attachSuggest(el, el.dataset.suggest);
    });
  }

  window.wsSuggest = { attachSuggest, attachAll, tokenAt };
  document.addEventListener('DOMContentLoaded', () => attachAll());
  document.addEventListener('htmx:after:swap', (e) => attachAll(e.detail && e.detail.target));
}());
