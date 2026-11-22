// Built from src/browser by `npm run build:browser`: edit the .ts source there, not this file.
"use strict";
(function() {
  "use strict";
  const selectionOf = (el) => {
    const root = el.getRootNode();
    return root.getSelection ? root.getSelection() : window.getSelection();
  };
  const hasValue = (el) => "value" in el;
  const isCE = (el) => !("value" in el) && el.isContentEditable;
  function ceCaret(el) {
    const sel = selectionOf(el);
    const length = (el.textContent || "").length;
    if (!sel || sel.rangeCount === 0) return length;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return length;
    const probe = range.cloneRange();
    probe.selectNodeContents(el);
    probe.setEnd(range.startContainer, range.startOffset);
    return probe.toString().length;
  }
  function ceSetCaret(el, offset) {
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let seen = 0;
    let node = walker.nextNode();
    while (node) {
      const len = (node.nodeValue || "").length;
      if (seen + len >= offset) {
        const range2 = doc.createRange();
        range2.setStart(node, Math.max(0, offset - seen));
        range2.collapse(true);
        const sel2 = selectionOf(el);
        if (sel2) {
          sel2.removeAllRanges();
          sel2.addRange(range2);
        }
        return;
      }
      seen += len;
      node = walker.nextNode();
    }
    const range = doc.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = selectionOf(el);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  function readField(el) {
    if (isCE(el) || !hasValue(el)) return { value: el.textContent || "", caret: ceCaret(el) };
    const value = el.value || "";
    return { value, caret: el.selectionStart == null ? value.length : el.selectionStart };
  }
  function writeField(el, value, caret) {
    if (isCE(el) || !hasValue(el)) {
      el.textContent = value;
      ceSetCaret(el, caret);
      return;
    }
    el.value = value;
    try {
      el.setSelectionRange(caret, caret);
    } catch (_) {
    }
  }
  const OPEN_CLASS = "ws-suggest-open";
  const TRIGGERS = ["@", "/"];
  const cache = /* @__PURE__ */ new Map();
  const CACHE_TTL = 4e3;
  async function fetchItems(url, trigger, typed) {
    const key = `${url}|${trigger}|${typed}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) return hit.items;
    const qs = `trigger=${encodeURIComponent(trigger)}&q=${encodeURIComponent(typed)}`;
    try {
      const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}${qs}`, {
        headers: { Accept: "application/json" }
      });
      if (!res.ok) return [];
      const items = await res.json();
      cache.set(key, { at: Date.now(), items });
      return items;
    } catch (_) {
      return [];
    }
  }
  function tokenAt(value, caret) {
    const upto = value.slice(0, caret);
    for (const trigger of TRIGGERS) {
      const at = upto.lastIndexOf(trigger);
      if (at === -1) continue;
      const before = at === 0 ? "" : upto[at - 1];
      if (before && !/\s/.test(before)) continue;
      const typed = upto.slice(at + 1);
      if (/[\s"']/.test(typed)) continue;
      if (trigger === "/" && at !== 0 && !/^\s*$/.test(upto.slice(0, at))) continue;
      return { trigger, at, typed };
    }
    return null;
  }
  const KIND_ICON = { agent: "robot", skill: "paperclip", command: "command" };
  const iconSvg = (kind) => `<svg class="tabler-icon" width="15" height="15" aria-hidden="true"><use href="/vendor/tabler-sprite.svg#${KIND_ICON[kind] || "point"}"></use></svg>`;
  function popupFor(el) {
    if (el._wsSuggestBox) return el._wsSuggestBox;
    const box = document.createElement("div");
    box.className = "ws-suggest";
    box.setAttribute("role", "listbox");
    box.hidden = true;
    document.body.appendChild(box);
    el._wsSuggestBox = box;
    return box;
  }
  const MIN_WIDTH = 560;
  const MAX_WIDTH = 780;
  function place(box, el) {
    const r = el.getBoundingClientRect();
    const room = window.innerWidth - 24;
    const width = Math.min(Math.max(MIN_WIDTH, r.width), MAX_WIDTH, room);
    box.style.width = `${width}px`;
    box.style.left = `${Math.max(12, Math.min(r.left, window.innerWidth - width - 12))}px`;
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
      el.removeAttribute("aria-activedescendant");
    };
    const render = () => {
      const t = token;
      if (!items.length || !t) {
        close();
        return;
      }
      box.innerHTML = items.map((it, i) => `
        <div class="ws-suggest-row${i === active ? " is-active" : ""}" role="option"
             id="ws-suggest-${i}" aria-selected="${i === active}" data-i="${i}">
          <span class="ws-suggest-icon">${iconSvg(it.kind)}</span>
          <span class="ws-suggest-name">${t.trigger}${escapeHtml(it.name)}</span>
          <span class="ws-suggest-kind">${escapeHtml(it.kind)}</span>
          <span class="ws-suggest-where">${escapeHtml(it.where)}</span>
          <div class="ws-suggest-desc">${escapeHtml(it.description || "")}</div>
        </div>`).join("");
      box.hidden = false;
      box.classList.add(OPEN_CLASS);
      place(box, el);
      const activeRow = box.querySelector(".is-active");
      if (activeRow) activeRow.scrollIntoView({ block: "nearest" });
      el.setAttribute("aria-activedescendant", `ws-suggest-${active}`);
    };
    const insert = (it) => {
      if (!token || !it) return;
      const { value, caret } = readField(el);
      const before = value.slice(0, token.at);
      const after = value.slice(caret);
      const ambiguous = items.filter((o) => o.name === it.name).length > 1;
      const insertion = ambiguous ? `${token.trigger}${it.name} (${it.kind}) ` : `${token.trigger}${it.name} `;
      writeField(el, `${before}${insertion}${after}`, before.length + insertion.length);
      close();
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.focus();
    };
    const refresh = async () => {
      const { value, caret } = readField(el);
      const t = tokenAt(value, caret);
      if (!t) {
        close();
        return;
      }
      token = t;
      const found = await fetchItems(url, t.trigger, t.typed);
      const now = readField(el);
      const still = tokenAt(now.value, now.caret);
      if (!still || still.trigger !== t.trigger || still.at !== t.at) return;
      token = still;
      items = found;
      active = 0;
      render();
    };
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 90);
    };
    el.addEventListener("input", schedule);
    el.addEventListener("keyup", (e) => {
      if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) schedule();
    });
    el.addEventListener("click", schedule);
    el.addEventListener("blur", () => setTimeout(close, 150));
    el.addEventListener("keydown", (e) => {
      if (box.hidden) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        render();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopPropagation();
        insert(items[active]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }, true);
    box.addEventListener("mousedown", (e) => {
      const row = e.target instanceof Element ? e.target.closest(".ws-suggest-row") : null;
      if (!row) return;
      e.preventDefault();
      insert(items[Number(row.dataset.i)]);
    });
    window.addEventListener("resize", () => {
      if (!box.hidden) place(box, el);
    });
    window.addEventListener("scroll", () => {
      if (!box.hidden) place(box, el);
    }, true);
  }
  const ENTITIES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
  }
  function attachAll(root) {
    (root && typeof root.querySelectorAll === "function" ? root : document).querySelectorAll("[data-suggest]").forEach((el) => {
      attachSuggest(el, el.dataset.suggest || "");
    });
  }
  window.wsSuggest = { attachSuggest, attachAll, tokenAt };
  document.addEventListener("DOMContentLoaded", () => attachAll());
  document.addEventListener("htmx:after:swap", (e) => {
    const detail = e.detail;
    attachAll(detail && detail.target);
  });
})();
