// Floating means floating: the panel can be dragged anywhere on the screen, because where it should sit
// depends on what is under it — a project table, a form, a terminal — and that changes page by page.
//
// The header is the handle (a window's title bar is), minus its buttons: a drag that started on the
// close button would close the panel on release. The position is per browser, clamped into the viewport
// on every apply, so a panel dragged to the edge of a wide screen is still reachable on a narrow one.
(function draggableAssistant() {
  const KEY = 'ws-assistant-pos';
  const panel = () => document.querySelector<HTMLElement>('.assistant-side');

  const clamp = (x: number, y: number, el: Element): [number, number] => {
    const r = el.getBoundingClientRect();
    // A strip of the panel always has to stay on screen, and the header has to stay reachable.
    const maxX = Math.max(0, window.innerWidth - r.width);
    const maxY = Math.max(0, window.innerHeight - Math.min(r.height, 64));
    return [Math.min(Math.max(0, x), maxX), Math.min(Math.max(0, y), maxY)];
  };

  const place = (x: number, y: number) => {
    const el = panel();
    if (!el) return;
    const [cx, cy] = clamp(x, y, el);
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    el.style.bottom = 'auto';
    el.style.right = 'auto';
  };

  const stored = (): { x: unknown; y: unknown } | null => {
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
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) place(p.x as number, p.y as number);
  }

  document.addEventListener('pointerdown', (e) => {
    if (document.documentElement.dataset.assistantView !== 'float') return;
    const head = (e.target as Element).closest<HTMLElement>('.assistant-side .assistant-head');
    if (!head || (e.target as Element).closest('button, a, input, select, .assistant-dropdown')) return;
    const el = panel()!;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    let moved = false;
    head.setPointerCapture(e.pointerId);
    el.classList.add('is-dragging');

    const move = (ev: PointerEvent) => { moved = true; place(ev.clientX - dx, ev.clientY - dy); };
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

