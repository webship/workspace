/* Drag to reorder the workspaces: the cards on the home page and the list in Settings.
 *
 * A list says it is sortable with data-sortable="<item selector>" and carries data-order, data-file and data-key
 * for /actions/list-order. The dragged item follows the pointer, the others slide into place, the page scrolls
 * at its edges, and the order is saved without redrawing the list. Alt+arrow keys move the focused item. */
(() => {
  const SKIP = 'button, input, select, textarea, .ws-card-tool, .ws-backups, .ws-move, .ws-delete-step, [data-no-drag]';
  const THRESHOLD = 6;
  const EDGE = 64;
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  let drag = null;
  let suppressClick = false;

  const itemsOf = (list) => [...list.children].filter((el) => el.matches(list.dataset.sortable));
  const orderOf = (list) => itemsOf(list).map((el) => el.dataset.ws).filter(Boolean);
  // The visible box of an item: a grid card sits inside its column's gutter padding.
  const visualOf = (item) => item.querySelector(':scope > .workspace-card') || item;

  // How far an item is still sliding.
  function offsetOf(el) {
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return { x: 0, y: 0 };
    const m = new DOMMatrixReadOnly(t);
    return { x: m.m41, y: m.m42 };
  }

  // Where an element sits in the layout, without the slide its item may still be making.
  function slotRect(item, el = item) {
    const r = el.getBoundingClientRect();
    const o = offsetOf(item);
    return new DOMRect(r.left - o.x, r.top - o.y, r.width, r.height);
  }

  // A row's number and its first/last arrows follow its new place, since the list is not redrawn.
  function renumber(list) {
    const els = itemsOf(list);
    els.forEach((el, i) => {
      const n = el.querySelector(':scope > .ws-order');
      if (n) n.textContent = String(i + 1);
      const [up, down] = el.querySelectorAll(':scope > .ws-move > button');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === els.length - 1;
    });
  }

  // Move items, then slide each from where it was to where it now is.
  function flip(list, mutate) {
    const els = itemsOf(list);
    const before = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
    mutate();
    renumber(list);
    els.forEach((el) => {
      const a = before.get(el);
      const b = slotRect(el);
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        el.style.transition = `transform 200ms ${EASE}`;
        el.style.transform = '';
      });
    });
  }

  function scrollerOf(el) {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return null;
  }

  function start(e) {
    const { list, item } = drag;
    const vis = visualOf(item);
    const rect = vis.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    ghost.classList.add('sort-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    // A card carries uk-position-relative, whose !important would put the copy back in the page flow.
    ghost.style.setProperty('position', 'fixed', 'important');
    document.body.appendChild(ghost);
    requestAnimationFrame(() => ghost.classList.add('is-lifted'));
    item.style.setProperty('--sort-inset-left', `${rect.left - item.getBoundingClientRect().left}px`);
    item.classList.add('sort-placeholder');
    document.body.classList.add('is-sorting');
    window.getSelection()?.removeAllRanges();
    Object.assign(drag, { ghost, rect, started: true, scroller: scrollerOf(list), next: item.nextSibling });
    move(e);
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function move(e) {
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.ghost.style.translate = `${e.clientX - drag.startX}px ${e.clientY - drag.startY}px`;
    place();
  }

  // Put the placeholder where the pointer is. An item under the pointer takes the placeholder's place; between
  // items nothing moves, so a slide in progress never flips the order back.
  function place() {
    const { list, item, x, y } = drag;
    const els = itemsOf(list);
    const hit = els.find((el) => {
      const r = el === item ? slotRect(el) : slotRect(el, visualOf(el));
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    let target = null;
    let after = false;
    if (hit && hit !== item) {
      target = hit;
      after = els.indexOf(hit) > els.indexOf(item);
    } else if (!hit) {
      const last = els[els.length - 1];
      const first = els[0];
      const lr = slotRect(last, visualOf(last));
      const fr = slotRect(first, visualOf(first));
      if (last !== item && (y > lr.bottom || (y >= lr.top && x > lr.right))) { target = last; after = true; }
      else if (first !== item && (y < fr.top || (y <= fr.bottom && x < fr.left))) { target = first; after = false; }
    }
    if (!target) return;
    flip(list, () => list.insertBefore(item, after ? target.nextSibling : target));
  }

  function autoScroll() {
    if (!drag || !drag.started) return;
    const s = drag.scroller;
    const top = s ? s.getBoundingClientRect().top : 0;
    const bottom = s ? s.getBoundingClientRect().bottom : window.innerHeight;
    let dy = 0;
    if (drag.y < top + EDGE) dy = -Math.ceil((top + EDGE - drag.y) / 4);
    else if (drag.y > bottom - EDGE) dy = Math.ceil((drag.y - (bottom - EDGE)) / 4);
    if (dy) {
      if (s) s.scrollTop += dy; else window.scrollBy(0, dy);
      place();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  // Land the ghost on the placeholder, then let the item show again.
  function finish(cancelled) {
    const d = drag;
    drag = null;
    cancelAnimationFrame(d.raf);
    document.body.classList.remove('is-sorting');
    if (cancelled) flip(d.list, () => d.list.insertBefore(d.item, d.next));
    const to = slotRect(d.item, visualOf(d.item));
    d.ghost.classList.remove('is-lifted');
    d.ghost.classList.add('is-landing');
    d.ghost.style.translate = `${to.left - d.rect.left}px ${to.top - d.rect.top}px`;
    const done = () => { d.ghost.remove(); d.item.classList.remove('sort-placeholder'); d.item.style.removeProperty('--sort-inset-left'); };
    d.ghost.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 260);
    if (!cancelled && orderOf(d.list).join(',') !== d.was) save(d.list, d.was);
  }

  // Save without redrawing: the list already shows the new order. A refusal brings back the server's list.
  async function save(list, was) {
    const order = orderOf(list).join(',');
    const body = new URLSearchParams({ order, was, file: list.dataset.file || 'settings.yml', key: list.dataset.key || 'workspaces' });
    if (list.dataset.sortableView) body.set('view', list.dataset.sortableView);
    const wrap = list.closest('#workspace-cards-wrap, [id^="list-editor"]');
    let res;
    let html = '';
    try {
      res = await fetch('/actions/list-order', { method: 'POST', body, headers: { 'HX-Request': 'true' }, credentials: 'same-origin' });
      html = await res.text();
    } catch (_) {
      res = null;
    }
    if (res && res.ok) {
      list.dataset.order = order;
      const msg = new DOMParser().parseFromString(html, 'text/html').querySelector('.msg');
      if (msg && wrap) { wrap.appendChild(msg); if (typeof window.flashResults === 'function') window.flashResults(wrap); }
      return;
    }
    if (wrap && html) {
      const id = wrap.id;
      wrap.outerHTML = html;
      const fresh = document.getElementById(id);
      if (fresh && window.htmx) window.htmx.process(fresh);
      if (fresh && typeof window.flashResults === 'function') window.flashResults(fresh);
    }
  }

  document.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0 || !e.isPrimary) return;
    const list = e.target.closest('[data-sortable]');
    if (!list) return;
    const item = e.target.closest(list.dataset.sortable);
    if (!item || item.parentElement !== list || e.target.closest(SKIP)) return;
    // On a touch screen the page must still scroll, so only the handle drags there.
    if (e.pointerType === 'touch' && !e.target.closest('.ws-card-handle, .ws-handle')) return;
    drag = { list, item, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, started: false, was: orderOf(list).join(',') };
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < THRESHOLD) return;
      start(e);
      return;
    }
    e.preventDefault();
    move(e);
  }, { passive: false });

  document.addEventListener('pointerup', () => {
    if (!drag) return;
    if (!drag.started) { drag = null; return; }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    finish(false);
  });

  document.addEventListener('pointercancel', () => { if (drag && drag.started) finish(true); else drag = null; });

  // A drag that ends on a card is not a click on its link.
  document.addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // Links and images are natively draggable, which would take the pointer away mid-drag.
  document.addEventListener('dragstart', (e) => { if (e.target.closest && e.target.closest('[data-sortable]')) e.preventDefault(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drag && drag.started) { e.preventDefault(); finish(true); return; }
    if (!e.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const list = e.target.closest && e.target.closest('[data-sortable]');
    const item = list && e.target.closest(list.dataset.sortable);
    if (!item || item.parentElement !== list) return;
    const els = itemsOf(list);
    const i = els.indexOf(item);
    const j = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : i + 1;
    if (j < 0 || j >= els.length) return;
    e.preventDefault();
    const was = orderOf(list).join(',');
    flip(list, () => list.insertBefore(item, j > i ? els[j].nextSibling : els[j]));
    e.target.focus();
    save(list, was);
  });
})();
