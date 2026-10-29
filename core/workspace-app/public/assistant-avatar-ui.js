// The assistant's avatar, wired to the page.
//
// The robot button in the assistant's header shows the avatar (Druplicon, or another one settings.yml
// `assistant.avatars:` names and the settings pop picks) and hides it again;
// hidden means silent, and its windows close with it. While shown it thinks while a reply is on its way,
// moves its mouth with the spoken summary, and acts out the reply: the moves written in it ([wave] …),
// the board (BOARD: and DRAW:, drawn stroke by stroke), a video (SHOW:), a page (BROWSE:, read through
// /fragments/reader) and where it flies to (MOVE:). Shown, it is free on the page, never confined to the
// assistant's panel. Quick replies under it answer the assistant in one click.
//
// The 3D part (assistant-avatar.js, three.js and the model) is fetched the first time it is shown.
(function () {
  const root = document.documentElement;
  const toggle = document.querySelector('.assistant-avatar-toggle');
  const stage = document.querySelector('.assistant-avatar-stage');
  if (!toggle || !stage) return;
  const canvas = stage.querySelector('.assistant-avatar-canvas');
  // Every control lives behind the robot button in the assistant's header: showing it, its tools and all its
  // settings, in one menu. The avatar itself is free on the page and carries none.
  const menuBtn = document.querySelector('.assistant-avatar-menu-btn');
  const bar = document.querySelector('.assistant-avatar-bar');
  // The voice dock under the conversation, as in the avatar app: voice on or off, hold to talk, keep listening.
  const dock = document.querySelector('.assistant-dock');
  const mute = dock.querySelector('.dock-voice');
  const chips = document.querySelector('.assistant-avatar-chips');
  const home = stage.parentNode;                 // where the stage lives in the panel
  const homeNext = stage.nextSibling;
  const pref = (k, v) => { try { window.wsPrefSet(k, v); } catch (_) { /* no cookie, no memory of it */ } };
  const getPref = (k, d) => { try { return window.wsPref(k, d); } catch (_) { return d; } };
  const voice = () => window.wsAssistantVoice || null;
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const svg = (d, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  // The interface glyphs, in public/vendor/webship-icons.
  // An interface icon is drawn as a mask in the text colour, at its own size from the design, so it takes the
  // hover blue, the pressed state and dark mode from CSS; a brand icon (value, service) keeps its own colours.
  const VI = '/vendor/webship-icons';
  const vi = (name, label = '') => `<span class="vi vi-${name}" style="-webkit-mask-image:url(${VI}/ui/${name}.svg);mask-image:url(${VI}/ui/${name}.svg)"${label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"'}></span>`;
  const ICON = {
    speaker: '<path d="M11 5 6 9H2v6h4l5 4V5z"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    tab: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  };

  // ---- Voice and the two header controls -------------------------------------------------------
  const paintMute = () => {
    const on = voice() ? voice().isOn() : false;
    mute.innerHTML = vi(on ? 'sound-on' : 'sound-off');
    mute.setAttribute('aria-pressed', String(on));
    mute.title = on ? 'The voice is on: click to mute it' : 'The voice is off: click to hear the answers';
    mute.setAttribute('aria-label', mute.title);
  };
  const paintToggle = (on) => {
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Hide the avatar' : 'Show the avatar';
    toggle.title = on ? "Hide the assistant's avatar, and mute it" : "Show the assistant's avatar";
    if (menuBtn) menuBtn.classList.toggle('is-current', on);
  };

  // ---- The avatar itself -----------------------------------------------------------------------
  // Who it can be: only the avatars settings.yml names (server.js puts them on the stage). The one picked
  // is kept per browser.
  let cast = { start: 'druplicon', avatars: [] };
  try { cast = { ...cast, ...JSON.parse(stage.dataset.cast || '{}') }; } catch (_) { /* Druplicon alone */ }
  if (!cast.avatars.length) cast.avatars = [{ id: 'druplicon', name: 'Druplicon', model: '/avatar/druplicon.vrm', credit: '' }];
  const who = () => cast.avatars.find((a) => a.id === getPref('ws-avatar-who', cast.start)) || cast.avatars.find((a) => a.id === cast.start) || cast.avatars[0];
  window.wsAvatarName = () => who().name;
  window.wsAvatarId = () => who().id;
  // 2D (flat, a cartoon drawing) or 3D (lit, in perspective), per browser; 2D unless 3D was chosen.
  const lookPref = () => (getPref('ws-avatar-look', '2d') === '3d' ? '3d' : '2d');
  // Its hair colour, per avatar and per browser; settings.yml's avatar_hair is where it starts.
  // The colours picked for each part of an avatar (its suit, cape, hair…), per avatar and per browser.
  const coloursOf = (a) => { try { const c = JSON.parse(getPref(`ws-avatar-colours-${a.id}`, '') || '{}'); return c && typeof c === 'object' ? c : {}; } catch (_) { return {}; } };
  const saveColours = (a, c) => pref(`ws-avatar-colours-${a.id}`, JSON.stringify(c));
  const hairOf = (a) => { const v = String(getPref(`ws-avatar-hair-${a.id}`, '') || ''); return /^#[0-9a-f]{6}$/i.test(v) ? v : (a.hair || ''); };
  let avatar = null;
  let loading = null;
  // Each avatar keeps its own voice, any of them an ElevenLabs one; until one is picked for it, the best
  // free voice. ElevenLabs is never a default: it spends credits, so it is always somebody's choice.
  const useVoiceOf = (a) => { if (voice() && voice().set) voice().set('voiceName', String(getPref(`ws-voice-name-${a.id}`, '') || '')); };
  function mount(greet) {
    if (avatar || loading) return;
    const picked = who();
    useVoiceOf(picked);
    stage.setAttribute('aria-label', `${picked.name}, the assistant's avatar`);
    loading = import('/assistant-avatar.js')
      .then((m) => m.mountAvatar(canvas, { model: picked.model, moves: picked.moves || '', hair: hairOf(picked), box: () => floatCard.getBoundingClientRect(), look: lookPref() }))
      .then((a) => {
        loading = null;
        if (!root.classList.contains('assistant-avatar-on') || who().id !== picked.id) { a.dispose(); if (root.classList.contains('assistant-avatar-on')) mount(greet); return; }
        avatar = a;
        for (const [part, hex] of Object.entries(coloursOf(picked))) if (/^#[0-9a-f]{6}$/i.test(String(hex))) avatar.setColour(part, hex);
        stage.classList.add('is-ready');
        if (greet) avatar.gesture('wave');
      })
      .catch((err) => { loading = null; stage.classList.add('is-failed'); console.warn('The avatar could not be shown:', err); });
  }
  // A few moves one after another, as the reply wrote them: a big move (BIG, below) takes as long as its
  // journey, any other about 1.7 s. A newer reply's moves replace whatever is still waiting.
  let playing = 0;
  async function play(list) {
    const run = ++playing;
    for (const g of list || []) {
      if (run !== playing || !avatar) return;
      if (BIG[g]) await BIG[g]();
      else { avatar.gesture(g); await new Promise((r) => setTimeout(r, 1700)); }
    }
  }

  // ---- Free on the page: Druplicon alone, no card, flying from place to place ----------------------
  // Shown, it is never confined to the assistant's panel: the stage moves into a frameless layer of its
  // own on the page. Drag Druplicon itself to put it somewhere; it flies there itself when the reply says
  // MOVE:, and now and then on its own while nothing is happening (not with reduced motion).
  const floatCard = document.createElement('section');
  floatCard.className = 'avatar-float';
  floatCard.setAttribute('aria-label', "The assistant's avatar");
  // The drawing covers the whole window, click-through, so its moves and flights have the full browser
  // and never meet an edge; the card above is where it stands, and what you drag.
  const layer = document.createElement('div');
  layer.className = 'avatar-layer';
  let popped = false;
  const PLACES = { left: [0.04, 0.6], center: [0.5, 0.55], right: [0.96, 0.6], panel: [0, 0.55] };
  // Where it can stand without covering the assistant's conversation.
  const panelBox = () => {
    const panel = document.querySelector('.assistant-side');
    return panel && !root.classList.contains('assistant-closed') ? panel.getBoundingClientRect() : null;
  };
  const freeLeft = () => { const p = panelBox(); return p ? p.right + 8 : 8; };
  // Its home: just beside the assistant's text box, its feet level with the bottom of the panel. It
  // stays near there unless it is moved, or told to roam the whole page.
  const homeSpot = () => {
    const r = floatCard.getBoundingClientRect(); const p = panelBox();
    return [freeLeft(), (p ? p.bottom : window.innerHeight - 8) - r.height];
  };
  const roams = () => getPref('ws-avatar-roam', '0') === '1';
  function flyTo(x, y) {
    const r = floatCard.getBoundingClientRect();
    const nx = Math.max(freeLeft(), Math.min(window.innerWidth - r.width - 8, x));
    const ny = Math.max(64, Math.min(window.innerHeight - r.height - 4, y));
    const far = Math.hypot(nx - r.left, ny - r.top) > 40;
    if (far && avatar) avatar.gesture('fly');
    floatCard.style.left = `${nx}px`;
    floatCard.style.top = `${ny}px`;
    pref('ws-avatar-at', `${Math.round(nx)},${Math.round(ny)}`);
  }
  function place(where) {
    if (where === 'home') { flyTo(...homeSpot()); return; }
    const r = floatCard.getBoundingClientRect();
    const [fx, fy] = PLACES[where] || PLACES.right;
    flyTo(where === 'panel' ? freeLeft() : fx * window.innerWidth - r.width * fx, fy * window.innerHeight - r.height / 2);
  }
  function popOut(where) {
    if (popped) { if (where) place(where); return; }
    popped = true;
    if (!floatCard.isConnected) document.body.appendChild(floatCard);
    if (!layer.isConnected) document.body.appendChild(layer);
    layer.appendChild(stage);
    applySize();
    root.classList.add('avatar-popped');
    const at = String(getPref('ws-avatar-at', '')).split(',').map(Number);
    if (where) place(where);
    // Where it was left, when it roams; by the text box otherwise, wherever the panel is now.
    else if (roams() && at.length === 2 && at.every(Number.isFinite)) { floatCard.style.left = `${at[0]}px`; floatCard.style.top = `${at[1]}px`; }
    else place('home');
  }
  function popIn() {
    if (!popped) return;
    popped = false;
    home.insertBefore(stage, homeNext);
    floatCard.remove();
    layer.remove();
    root.classList.remove('avatar-popped');
  }
  // Dragging: a window by its title bar, Druplicon by Druplicon itself (a click without moving is a click).
  function draggable(box, handle, { onStart, onEnd } = {}) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button, a, input, form')) return;
      const r = box.getBoundingClientRect(); const dx = e.clientX - r.left; const dy = e.clientY - r.top;
      const sx = e.clientX; const sy = e.clientY; let moved = false;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
        if (!moved) { moved = true; box.classList.add('is-dragging'); if (onStart) onStart(); }
        box.style.left = `${Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - dx))}px`;
        box.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up);
        box.classList.remove('is-dragging');
        if (moved && onEnd) onEnd();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }
  draggable(floatCard, floatCard, {
    onStart: () => { if (avatar) avatar.gesture('fly'); },
    onEnd: () => { const r = floatCard.getBoundingClientRect(); pref('ws-avatar-at', `${Math.round(r.left)},${Math.round(r.top)}`); },
  });
  // Now and then, while nothing is going on, it flies somewhere else on the page.
  let lastActivity = Date.now();
  const busy = () => document.querySelector('.assistant-panel[data-working]')
    || (window.speechSynthesis && window.speechSynthesis.speaking) || floatCard.matches(':hover') || bar.matches(':focus-within');
  setInterval(() => {
    if (!popped || !avatar || !wanders() || reduced() || busy() || Date.now() - lastActivity < 15000 + Math.random() * 10000) return;
    lastActivity = Date.now();
    const r = floatCard.getBoundingClientRect();
    if (roams()) { flyTo(freeLeft() + Math.random() * (window.innerWidth - freeLeft() - r.width), window.innerHeight * (0.35 + Math.random() * 0.4) - r.height / 2); return; }
    // Near the text box: a short hop around its home, and back.
    const [hx, hy] = homeSpot();
    flyTo(hx + Math.random() * Math.min(260, window.innerWidth * 0.18), hy - Math.random() * Math.min(160, window.innerHeight * 0.15));
  }, 5000);
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));

  // ---- Big moves: the whole figure travels the page ------------------------------------------------
  // The card follows a path frame by frame (the drawing follows the card), while the body does a move
  // to match: a walk, a flight, a leap. Each ends where it began, or at home. With reduced motion only the
  // move on the spot is done.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const at = () => { const r = floatCard.getBoundingClientRect(); return [r.left, r.top]; };
  const inPage = ([x, y]) => {
    const r = floatCard.getBoundingClientRect();
    return [Math.max(freeLeft(), Math.min(window.innerWidth - r.width - 8, x)), Math.max(64, Math.min(window.innerHeight - r.height - 4, y))];
  };
  // Along the points (page coordinates of the card), in `ms`, repeating `move` every `every` ms.
  function travel(points, ms, move, every = 1100) {
    return new Promise((done) => {
      const pts = [at(), ...points.map(inPage)];
      const legs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
      const total = legs.reduce((a, b) => a + b, 0) || 1;
      floatCard.classList.add('is-travelling');
      const t0 = performance.now(); let nextMove = 0;
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ms);
        if (move && avatar && now >= nextMove) { avatar.gesture(move); nextMove = now + every; }
        let d = (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2) * total; let i = 0;
        while (i < legs.length - 1 && d > legs[i]) { d -= legs[i]; i += 1; }
        const f = legs[i] ? Math.min(1, d / legs[i]) : 1;
        floatCard.style.left = `${pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f}px`;
        floatCard.style.top = `${pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f}px`;
        if (k < 1 && popped) requestAnimationFrame(step);
        else { floatCard.classList.remove('is-travelling'); done(); }
      };
      requestAnimationFrame(step);
    });
  }
  const still = (move, ms) => { if (avatar) avatar.gesture(move); return wait(ms); };
  const BIG = {
    // A loop round the page and back home.
    async tour() {
      if (reduced()) return still('fly', 1500);
      const w = window.innerWidth; const h = window.innerHeight; const r = floatCard.getBoundingClientRect();
      await travel([[w - r.width - 30, h * 0.12], [w * 0.55, 70], [freeLeft() + 20, h * 0.2], [freeLeft() + 40, h * 0.6], homeSpot()], 7000, 'fly', 1300);
    },
    // A walk across to the far side, a wave, and back.
    async dash() {
      if (reduced()) return still('walk', 1200);
      const back = at(); const r = floatCard.getBoundingClientRect();
      await travel([[window.innerWidth - r.width - 30, back[1]]], 2600, 'walk');
      await still('wave', 1400);
      await travel([back], 2600, 'walk');
    },
    // A big leap up the page and down again.
    async jump() {
      if (reduced()) return still('leap', 1300);
      const [x, y] = at();
      avatar.gesture('leap');
      await wait(330);
      await travel([[x, y - window.innerHeight * 0.3]], 420, null);
      await travel([[x, y]], 480, null);
      await wait(250);
    },
    // Grows to its biggest, waves, and back to the size it was.
    async zoom() {
      const was = floatCard.dataset.size || 'medium';
      resize('huge'); await still('wave', 2600); resize(was); await wait(600);
    },
    // Walks to the middle, grows, explains, then goes home at the size it was.
    async present() {
      const was = floatCard.dataset.size || 'medium';
      if (!reduced()) { const r = floatCard.getBoundingClientRect(); await travel([[(window.innerWidth - r.width) / 2, window.innerHeight * 0.3]], 2000, 'walk'); }
      resize('xl'); await wait(500); await still('explain', 4000);
      resize(was); await wait(400);
      if (!reduced()) await travel([homeSpot()], 2000, 'walk');
    },
    // A full turn on the spot.
    spin: () => still('spin', 1700),
  };

  // ---- Windows beside the avatar: the board, a video, a page -----------------------------------
  const windows = {};
  function windowFor(kind, title) {
    let w = windows[kind];
    if (!w) {
      w = document.createElement('section');
      w.className = `avatar-window avatar-window-${kind}`;
      w.setAttribute('role', 'dialog');
      w.innerHTML = `<header class="avatar-window-head"><strong></strong><span class="avatar-window-tools"></span>
        <button type="button" class="avatar-window-btn avatar-window-max" title="Fill the page" aria-label="Fill the page" aria-pressed="false">${svg(ICON.tab)}</button>
        <button type="button" class="avatar-window-btn avatar-window-close" title="Close" aria-label="Close">${svg(ICON.close)}</button></header>
        <div class="avatar-window-body"></div>`;
      w.querySelector('.avatar-window-close').addEventListener('click', () => closeWindow(kind));
      // Not limited to its first size: drag its corner, or fill the page and come back.
      w.querySelector('.avatar-window-max').addEventListener('click', (e) => {
        const on = w.classList.toggle('is-max');
        e.currentTarget.setAttribute('aria-pressed', String(on));
        e.currentTarget.title = on ? 'Back to its size' : 'Fill the page';
        e.currentTarget.setAttribute('aria-label', e.currentTarget.title);
      });
      draggable(w, w.querySelector('.avatar-window-head'));
      document.body.appendChild(w);
      windows[kind] = w;
      // Beside the avatar: to the left of it when it stands on the right, to its right otherwise.
      const a = floatCard.getBoundingClientRect();
      const width = Math.min(560, window.innerWidth - 32);
      const n = Object.keys(windows).length - 1;
      const left = a.left > window.innerWidth / 2 ? a.left - width - 16 : a.right + 16;
      w.style.left = `${Math.max(freeLeft() + 8, Math.min(window.innerWidth - width - 16, left)) + n * 24}px`;
      w.style.top = `${Math.max(80, a.top) + n * 24}px`;
      w.style.width = `${width}px`;
      // And Druplicon flies over beside it, to present it.
      setTimeout(() => {
        const wr = w.getBoundingClientRect(); const fr = floatCard.getBoundingClientRect();
        if (popped) flyTo(wr.right + 8 + fr.width < window.innerWidth ? wr.right + 8 : wr.left - fr.width - 8, wr.top + wr.height / 2 - fr.height / 2);
      }, 50);
    }
    w.querySelector('.avatar-window-head strong').textContent = title;
    if (openPop === 'windows') setTimeout(() => renderPop('windows'), 0);
    w.setAttribute('aria-label', title);
    w.hidden = false;
    return w;
  }
  function closeWindow(kind) {
    const w = windows[kind];
    if (!w) return;
    w.remove();
    delete windows[kind];
    if (videos && videos[kind]) {
      delete videos[kind];
      const left = Object.values(videos);
      video = left.length ? left[left.length - 1] : null;
      paintChips();
    }
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = Object.keys(windows);
    if (open.length && !document.querySelector('.uk-modal.uk-open')) closeWindow(open[open.length - 1]);
  });

  // The board: lines of text at the top, and shapes on a 100 x 60 grid drawn stroke by stroke.
  const NS = 'http://www.w3.org/2000/svg';
  // The board: a workspace for the team as well as for Druplicon. Lines of text at the top, a drawing on a
  // 100 x 60 grid that scales with the window, freehand pen, sticky notes to type in and drag, undo,
  // clear, and saving the drawing as SVG and the notes as Markdown.
  const added = [];                       // what was put on the board, newest last, for Undo
  function board() {
    const w = windowFor('board', 'Board');
    const body = w.querySelector('.avatar-window-body');
    if (!body.firstChild) {
      body.innerHTML = `<div class="avatar-board-bar" role="toolbar" aria-label="Board tools">
          <button type="button" class="avatar-chip" data-board="pen" aria-pressed="false">Pen</button>
          <span class="avatar-board-palette" role="group" aria-label="Pen colour">${['ink', 'blue', 'sky', 'teal', 'green', 'amber', 'coral', 'purple'].map((c, i) => `<button type="button" class="avatar-swatch" data-colour="${c}" aria-label="${c}" title="${c}" aria-pressed="${i === 0}" style="background:${COLOURS[c]}"></button>`).join('')}</span>
          <span class="avatar-board-widths" role="group" aria-label="Pen width">${[['fine', 0.15], ['thin', 0.3], ['medium', 0.6], ['bold', 1.1]].map(([l, w], i) => `<button type="button" class="avatar-chip" data-width="${w}" aria-pressed="${i === 1}">${l}</button>`).join('')}</span>
          <button type="button" class="avatar-chip" data-board="note">Note</button>
          <button type="button" class="avatar-chip" data-board="undo">Undo</button>
          <button type="button" class="avatar-chip" data-board="clear">Clear</button>
          <button type="button" class="avatar-chip" data-board="svg">Save drawing</button>
          <button type="button" class="avatar-chip avatar-chip-icon" data-board="md">${vi('bookmark-outlined')}Save notes</button>
        </div>
        <ol class="avatar-board-lines"></ol><div class="avatar-board-area"></div>`;
      const area = body.querySelector('.avatar-board-area');
      const s = document.createElementNS(NS, 'svg');
      s.setAttribute('viewBox', '0 0 100 60');
      s.setAttribute('class', 'avatar-board-svg');
      s.innerHTML = '<defs><marker id="avatar-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="currentColor"/></marker></defs>';
      area.appendChild(s);
      const pen = { colour: COLOURS.ink, width: 0.3 };
      body.querySelector('.avatar-board-bar').addEventListener('click', (e) => {
        const sw = e.target.closest('[data-colour], [data-width]');
        if (sw) {
          sw.parentElement.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === sw)));
          if (sw.dataset.colour) pen.colour = COLOURS[sw.dataset.colour];
          if (sw.dataset.width) pen.width = Number(sw.dataset.width);
          const penBtn = body.querySelector('[data-board="pen"]');
          if (penBtn.getAttribute('aria-pressed') !== 'true') penBtn.click();
          return;
        }
        const b = e.target.closest('[data-board]');
        if (!b) return;
        const act = b.dataset.board;
        if (act === 'pen') { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); area.classList.toggle('is-pen', on); }
        if (act === 'note') addNote(area, '');
        if (act === 'undo') { const last = added.pop(); if (last) last.remove(); }
        if (act === 'clear') clearBoard();
        if (act === 'svg') download('board.svg', 'image/svg+xml', `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(s).replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg" style="color:#2b447c;background:#fff"')}`);
        if (act === 'md') {
          const lines = [...body.querySelectorAll('.avatar-board-lines li')].map((li) => `1. ${li.textContent}`);
          const notes = [...area.querySelectorAll('.avatar-note-text')].map((n) => `- ${n.innerText.trim().replace(/\n+/g, ' ')}`).filter((l) => l.length > 2);
          download('board-notes.md', 'text/markdown', `# Board, ${new Date().toISOString().slice(0, 10)}\n\n${lines.join('\n')}${lines.length ? '\n\n' : ''}${notes.length ? `## Notes\n\n${notes.join('\n')}\n` : ''}`);
        }
      });
      // The pen: freehand strokes in the board's own coordinates, so they scale with it.
      let stroke = null;
      const at = (e) => { const r = s.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 60]; };
      s.addEventListener('pointerdown', (e) => {
        if (!area.classList.contains('is-pen')) return;
        e.preventDefault();
        s.setPointerCapture(e.pointerId);
        const [x, y] = at(e);
        stroke = document.createElementNS(NS, 'path');
        stroke.setAttribute('class', 'avatar-stroke avatar-ink');
        stroke.style.stroke = pen.colour;
        stroke.style.strokeWidth = String(pen.width);
        stroke.setAttribute('d', `M${x.toFixed(2)} ${y.toFixed(2)}`);
        s.appendChild(stroke);
        added.push(stroke);
      });
      s.addEventListener('pointermove', (e) => {
        if (!stroke) return;
        const [x, y] = at(e);
        stroke.setAttribute('d', `${stroke.getAttribute('d')} L${x.toFixed(2)} ${y.toFixed(2)}`);
      });
      ['pointerup', 'pointercancel'].forEach((ev) => s.addEventListener(ev, () => { stroke = null; }));
    }
    return { lines: body.querySelector('.avatar-board-lines'), svg: body.querySelector('svg'), area: body.querySelector('.avatar-board-area') };
  }
  const NOTE_STAMPS = ['improvement', 'sharing', 'respect', 'customer', 'mastery'];
  // A sticky note: type in it, drag it by its edge, remove it with its ×.
  function addNote(area, text) {
    const n = document.createElement('div');
    n.className = 'avatar-note';
    const count = area.querySelectorAll('.avatar-note').length;
    // In a row along the lower part of the board, below where a drawing usually goes, never on each other.
    n.style.left = `${2 + (count % 4) * 24.5}%`;
    n.style.top = `${56 + (Math.floor(count / 4) % 2) * 22}%`;
    // Each note carries one of the Webship values' marks, in turn: improvement, sharing, respect, customer, mastery.
    const stamp = NOTE_STAMPS[count % NOTE_STAMPS.length];
    n.innerHTML = `<div class="avatar-note-grip"><img class="avatar-note-stamp" src="${VI}/value/${stamp}-primary.svg" alt="" width="14" height="14"><button type="button" class="avatar-note-x" aria-label="Remove the note" title="Remove">×</button></div><div class="avatar-note-text" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Note"></div>`;
    n.querySelector('.avatar-note-text').textContent = text;
    n.querySelector('.avatar-note-x').addEventListener('click', () => n.remove());
    // Dragged inside the board: positions in percent, so a note stays put when the board is resized.
    n.querySelector('.avatar-note-grip').addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = area.getBoundingClientRect(); const nr = n.getBoundingClientRect();
      const dx = e.clientX - nr.left; const dy = e.clientY - nr.top;
      e.currentTarget.setPointerCapture(e.pointerId);
      const move = (ev) => {
        n.style.left = `${Math.max(0, Math.min(90, ((ev.clientX - dx - r.left) / r.width) * 100))}%`;
        n.style.top = `${Math.max(0, Math.min(90, ((ev.clientY - dy - r.top) / r.height) * 100))}%`;
      };
      const grip = e.currentTarget;
      const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up);
    });
    area.appendChild(n);
    added.push(n);
    if (!text) n.querySelector('.avatar-note-text').focus();
    return n;
  }
  function clearBoard() {
    const b = board();
    b.lines.replaceChildren();
    [...b.svg.querySelectorAll('rect, circle, line, text, path:not(marker path)')].forEach((e) => e.remove());
    b.area.querySelectorAll('.avatar-note').forEach((n) => n.remove());
    added.length = 0;
  }
  function download(name, type, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const num = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
  let strokeDelay = 0;
  // Colours by name, for the pen and for the assistant: a calm, friendly set on the brand's blues.
  const COLOURS = { ink: '#2b447c', blue: '#0074e0', sky: '#34ade2', teal: '#0f9d8a', green: '#3fa34d', amber: '#e5a00d',
    coral: '#ef6a5a', pink: '#d6589f', purple: '#7a5cc7', grey: '#7b8494', black: '#1d1d1f', white: '#ffffff' };
  const colour = (v, fallback) => {
    const c = String(v || '').toLowerCase();
    if (COLOURS[c]) return COLOURS[c];
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(c) ? c : fallback;
  };
  // Thin by default: the assistant draws like an artist, in fine lines, unless it asks for more.
  function shape(s, name, attrs, label, at, o = {}) {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.setAttribute('class', 'avatar-stroke');
    el.style.stroke = colour(o.color, '');
    el.style.strokeWidth = String(Math.max(0.08, Math.min(3, Number(o.width) || 0.3)));
    if (o.fill && o.fill !== 'none') { el.style.fill = colour(o.fill, 'none'); el.style.fillOpacity = String(Math.max(0.05, Math.min(1, Number(o.opacity) || 0.35))); }
    if (o.dash) el.style.strokeDasharray = '1 1';
    s.appendChild(el);
    added.push(el);
    // Drawn, not placed: the stroke runs out along the shape, one after another.
    if (!reduced() && el.getTotalLength && !o.dash) {
      const len = el.getTotalLength();
      el.style.strokeDasharray = len;
      el.style.strokeDashoffset = len;
      el.style.animation = `avatar-draw ${Math.min(1.6, 0.4 + len / 120).toFixed(2)}s ease ${strokeDelay}s forwards`;
    }
    if (label) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', at[0]); t.setAttribute('y', at[1]);
      t.setAttribute('class', 'avatar-board-label');
      if (o.color) t.style.fill = colour(o.color, '');
      t.textContent = label.slice(0, 40);
      if (!reduced()) t.style.animation = `avatar-fade .4s ease ${strokeDelay + 0.45}s both`;
      s.appendChild(t);
      added.push(t);
    }
    strokeDelay += 0.45;
  }
  // A smooth line through points (Catmull-Rom as cubic Béziers): the artist's curve.
  function smoothPath(pts) {
    if (pts.length < 2) return '';
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0]} ${p2[1]}`;
    }
    return d;
  }
  function draw(cmds) {
    const { svg: s } = board();
    strokeDelay = 0;
    for (const raw of cmds || []) {
      const all = String(raw).trim().split(/\s+/);
      const kind = (all.shift() || '').toLowerCase();
      // Options anywhere after the shape: color=teal fill=amber width=0.2 opacity=0.4 dash
      const o = {};
      const rest = all.filter((t) => {
        const m = t.match(/^(color|colour|fill|width|opacity)=(\S+)$/i);
        if (m) { o[m[1].toLowerCase() === 'colour' ? 'color' : m[1].toLowerCase()] = m[2]; return false; }
        if (/^dash(ed)?$/i.test(t)) { o.dash = true; return false; }
        return true;
      });
      const n = rest.slice(0, 4).map(Number);
      const label = (k) => rest.slice(k).join(' ').replace(/^["']|["']$/g, '');
      const points = () => {
        const nums = rest.map(Number).filter((v) => Number.isFinite(v));
        const pts = [];
        for (let i = 0; i + 1 < nums.length && pts.length < 40; i += 2) pts.push([num(nums[i], 100), num(nums[i + 1], 60)]);
        return pts;
      };
      switch (kind) {
        case 'box': case 'rect': {
          const [x, y, w, h] = [num(n[0], 100), num(n[1], 60), num(n[2], 100), num(n[3], 60)];
          shape(s, 'rect', { x, y, width: w, height: h, rx: 1.6 }, label(4), [x + w / 2, y + h / 2 + 1.2], o);
          break;
        }
        case 'circle': {
          const [x, y, r] = [num(n[0], 100), num(n[1], 60), num(n[2], 30)];
          shape(s, 'circle', { cx: x, cy: y, r }, label(3), [x, y + 1.2], o);
          break;
        }
        case 'ellipse': {
          const [x, y, rx, ry] = [num(n[0], 100), num(n[1], 60), num(n[2], 50), num(n[3], 30)];
          shape(s, 'ellipse', { cx: x, cy: y, rx, ry }, label(4), [x, y + 1.2], o);
          break;
        }
        case 'line': case 'arrow':
          shape(s, 'line', { x1: num(n[0], 100), y1: num(n[1], 60), x2: num(n[2], 100), y2: num(n[3], 60), ...(kind === 'arrow' ? { 'marker-end': 'url(#avatar-arrow)' } : {}) }, '', null, o);
          break;
        case 'curve': case 'poly': case 'polygon': {
          const pts = points();
          if (pts.length < 2) break;
          const d = kind === 'curve' ? smoothPath(pts) : `M${pts.map((p) => p.join(' ')).join(' L')}${kind === 'polygon' ? ' Z' : ''}`;
          shape(s, 'path', { d }, '', null, o);
          break;
        }
        case 'text': {
          const t = document.createElementNS(NS, 'text');
          t.setAttribute('x', num(n[0], 100)); t.setAttribute('y', num(n[1], 60));
          t.setAttribute('class', 'avatar-board-label avatar-board-text');
          if (o.color) t.style.fill = colour(o.color, '');
          if (o.width) t.style.fontSize = `${Math.max(1.5, Math.min(8, Number(o.width) * 3))}px`;
          t.textContent = label(2).slice(0, 60);
          if (!reduced()) t.style.animation = `avatar-fade .4s ease ${strokeDelay}s both`;
          strokeDelay += 0.3;
          s.appendChild(t);
          added.push(t);
          break;
        }
        case 'clear': clearBoard(); break;
        default: break;
      }
    }
  }
  function write(lines) {
    const b = board();
    for (const line of lines || []) {
      if (/^clear$/i.test(line)) { clearBoard(); continue; }
      const note = line.match(/^note:?\s+(.+)$/i);
      if (note) { addNote(b.area, note[1]); continue; }
      const li = document.createElement('li');
      li.textContent = line;
      b.lines.appendChild(li);
    }
  }

  // A video: YouTube's privacy-enhanced player, its pause and loop on the quick replies too.
  let video = null;
  // Every video gets a player of its own, opened and closed on its own, with its own controls: back and
  // forward ten seconds, play and pause, quieter and louder, mute, speed, restart and loop. The assistant
  // has the same set (VIDEO: …), acting on the latest player. YouTube tells each player's page where it
  // is (time, volume, speed) once asked to, which is what lets "forward" and "louder" know from where.
  const videos = {};
  const YT = 'https://www.youtube-nocookie.com';
  function videoCommand(func, args = [], v = video) {
    if (!v || !v.frame.contentWindow) return;
    v.frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args }), YT);
  }
  window.addEventListener('message', (e) => {
    if (e.origin !== YT) return;
    let d;
    try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (_) { return; }
    const v = Object.values(videos).find((x) => x.frame.contentWindow === e.source);
    if (!v || !d || !d.info) return;
    if (Number.isFinite(d.info.currentTime)) v.time = d.info.currentTime;
    if (Number.isFinite(d.info.volume)) v.volume = d.info.volume;
    if (typeof d.info.muted === 'boolean') v.muted = d.info.muted;
    if (Number.isFinite(d.info.playbackRate)) v.rate = d.info.playbackRate;
    if (Number.isFinite(d.info.playerState)) { v.paused = d.info.playerState === 2; paintVideo(v); }
  });
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  function controlVideo(raw, v = video) {
    if (!v) return;
    const [cmd, arg] = String(raw).trim().toLowerCase().split(/\s+/);
    const t = v.time || 0;
    switch (cmd) {
      case 'play': videoCommand('playVideo', [], v); v.paused = false; break;
      case 'pause': videoCommand('pauseVideo', [], v); v.paused = true; break;
      case 'toggle': controlVideo(v.paused ? 'play' : 'pause', v); return;
      case 'forward': videoCommand('seekTo', [t + (Number(arg) || 10), true], v); break;
      case 'back': videoCommand('seekTo', [Math.max(0, t - (Number(arg) || 10)), true], v); break;
      case 'restart': videoCommand('seekTo', [0, true], v); videoCommand('playVideo', [], v); break;
      case 'stop': videoCommand('pauseVideo', [], v); videoCommand('seekTo', [0, true], v); v.paused = true; break;
      case 'seek': {
        const parts = String(arg || '').split(':').map(Number);
        const secs = parts.reduce((acc, x) => acc * 60 + (Number.isFinite(x) ? x : 0), 0);
        videoCommand('seekTo', [secs, true], v);
        break;
      }
      case 'quieter': case 'louder': {
        v.volume = Math.max(0, Math.min(100, (Number.isFinite(v.volume) ? v.volume : 100) + (cmd === 'louder' ? 15 : -15)));
        videoCommand('setVolume', [v.volume], v);
        if (v.muted && cmd === 'louder') { videoCommand('unMute', [], v); v.muted = false; }
        break;
      }
      case 'volume': v.volume = Math.max(0, Math.min(100, Number(arg) || 0)); videoCommand('setVolume', [v.volume], v); break;
      case 'mute': videoCommand('mute', [], v); v.muted = true; break;
      case 'unmute': videoCommand('unMute', [], v); v.muted = false; break;
      case 'speed': {
        const next = Number(arg) || SPEEDS[(SPEEDS.indexOf(v.rate || 1) + 1) % SPEEDS.length];
        v.rate = Math.max(0.25, Math.min(2, next));
        videoCommand('setPlaybackRate', [v.rate], v);
        break;
      }
      case 'loop': { const { id, kind, loop } = v; closeWindow(kind); showVideo(id, !loop); return; }
      case 'close': closeWindow(v.kind); return;
      default: return;
    }
    paintVideo(v);
  }
  function paintVideo(v) {
    const w = windows[v.kind];
    if (!w) return;
    const play = w.querySelector('[data-video="toggle"]');
    if (play) { play.innerHTML = vi(v.paused ? 'play' : 'pause'); play.title = v.paused ? 'Play' : 'Pause'; play.setAttribute('aria-label', play.title); }
    const mute = w.querySelector('[data-video="mute"]');
    if (mute) { mute.setAttribute('aria-pressed', String(Boolean(v.muted))); mute.innerHTML = vi(v.muted ? 'sound-off' : 'sound-on'); }
    const speed = w.querySelector('[data-video="speed"]');
    if (speed) speed.textContent = `${v.rate || 1}×`;
    const loop = w.querySelector('[data-video="loop"]');
    if (loop) loop.setAttribute('aria-pressed', String(Boolean(v.loop)));
    if (v === video) paintChips();
  }
  function showVideo(id, loop = false) {
    if (!/^[\w-]{11}$/.test(id)) return;
    const kind = `video-${id}`;
    const w = windowFor(kind, 'Video');
    w.classList.add('avatar-window-video');
    const body = w.querySelector('.avatar-window-body');
    const src = `${YT}/embed/${id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}${loop ? `&loop=1&playlist=${id}` : ''}`;
    const btn = (cmd, title, inner) => `<button type="button" class="avatar-browser-btn" data-video="${cmd}" title="${title}" aria-label="${title}">${inner}</button>`;
    body.innerHTML = `<div class="avatar-video"><iframe allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
      <div class="avatar-video-bar" role="toolbar" aria-label="Video controls">
        ${btn('back', 'Back 10 seconds', svg('<path d="M11 17l-5-5 5-5M18 17l-5-5 5-5"/>'))}
        ${btn('toggle', 'Pause', vi('pause'))}
        ${btn('stop', 'Stop', vi('stop'))}
        ${btn('forward', 'Forward 10 seconds', svg('<path d="M13 17l5-5-5-5M6 17l5-5-5-5"/>'))}
        <span class="avatar-video-gap"></span>
        ${btn('quieter', 'Quieter', svg(ICON.speaker + '<path d="M16 12h5"/>'))}
        ${btn('louder', 'Louder', svg(ICON.speaker + '<path d="M16 12h5M18.5 9.5v5"/>'))}
        ${btn('mute', 'Mute', vi('sound-on'))}
        <span class="avatar-video-gap"></span>
        <button type="button" class="avatar-chip" data-video="speed" title="Speed" aria-label="Speed">1×</button>
        ${btn('restart', 'From the start', svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5"/>'))}
        <button type="button" class="avatar-chip" data-video="loop" aria-pressed="${loop}" title="Loop">Loop</button>
      </div>`;
    const f = body.querySelector('iframe');
    f.title = 'Video';
    f.src = src;
    const v = video = videos[kind] = { id, kind, loop, paused: false, muted: false, volume: 100, rate: 1, time: 0, frame: f };
    // Ask the player to report where it is, so the controls know.
    f.addEventListener('load', () => f.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: kind }), YT));
    body.querySelector('.avatar-video-bar').addEventListener('click', (e) => {
      const b = e.target.closest('[data-video]');
      if (b) { video = v; controlVideo(b.dataset.video, v); }
    });
    paintVideo(v);
    chips.hidden = false;
  }
  // The browser: a window with its own history, an address field, back, forward, reload, zoom and a real
  // tab, and the same commands for the assistant (BROWSE: back, down, find …, click …). Pages come
  // through the reader: served by the dashboard with no scripts at all, so this page may reach into them
  // (sandbox allow-same-origin, never allow-scripts) to scroll, find, click and read what is in view.
  const nav = { list: [], at: -1, zoom: 1 };
  const readerUrl = (href) => `/fragments/reader?u=${encodeURIComponent(href)}`;
  function browserWindow() {
    const w = windowFor('browser', 'Browser');
    const body = w.querySelector('.avatar-window-body');
    if (!body.querySelector('.avatar-reader')) {
      body.innerHTML = `<form class="avatar-browser-bar" role="toolbar" aria-label="Browser">
          <button type="button" class="avatar-browser-btn" data-nav="back" title="Back" aria-label="Back">${svg('<path d="M15 18l-6-6 6-6"/>')}</button>
          <button type="button" class="avatar-browser-btn" data-nav="forward" title="Forward" aria-label="Forward">${svg('<path d="M9 18l6-6-6-6"/>')}</button>
          <button type="button" class="avatar-browser-btn" data-nav="reload" title="Reload" aria-label="Reload">${svg('<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>')}</button>
          <input type="text" class="avatar-browser-address" aria-label="Address or search words" placeholder="Address or search words">
          <button type="button" class="avatar-browser-btn" data-nav="zoomout" title="Smaller text" aria-label="Smaller text">${svg('<path d="M5 12h14"/>')}</button>
          <button type="button" class="avatar-browser-btn" data-nav="zoomin" title="Bigger text" aria-label="Bigger text">${svg('<path d="M12 5v14M5 12h14"/>')}</button>
          <button type="button" class="avatar-browser-btn" data-nav="read" title="Read aloud what is in view" aria-label="Read aloud what is in view">${vi('sound-on')}</button>
          <button type="button" class="avatar-browser-btn" data-nav="newtab" title="Open in a real tab" aria-label="Open in a real tab">${vi('share')}</button>
        </form><iframe class="avatar-reader" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe>`;
      const form = body.querySelector('.avatar-browser-bar');
      form.addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) browserCommand(b.dataset.nav); });
      form.addEventListener('submit', (e) => { e.preventDefault(); openAnything(form.querySelector('input').value.trim()); });
      const f = body.querySelector('iframe');
      f.title = 'Browser';
      // A link clicked in a page stays in the window and in its history.
      f.addEventListener('load', () => {
        const doc = readerDoc();
        if (!doc) return;
        doc.documentElement.style.zoom = String(nav.zoom);
        w.querySelector('.avatar-window-head strong').textContent = doc.title || 'Browser';
        doc.addEventListener('click', (e) => {
          const link = e.target.closest && e.target.closest('a[href^="/fragments/reader?u="]');
          if (!link) return;
          e.preventDefault();
          browse(new URL(link.getAttribute('href'), location.origin).searchParams.get('u'));
        });
      });
    }
    return w;
  }
  const readerDoc = () => { try { return windows.browser && windows.browser.querySelector('.avatar-reader').contentDocument; } catch (_) { return null; } };
  function load(href) {
    const w = browserWindow();
    w.querySelector('.avatar-browser-address').value = href;
    w.querySelector('.avatar-reader').src = readerUrl(href);
  }
  function browse(link) {
    let u;
    try { u = new URL(link); } catch (_) { return; }
    if (u.protocol !== 'https:') return;
    nav.list = nav.list.slice(0, nav.at + 1);
    nav.list.push(u.href);
    nav.at = nav.list.length - 1;
    load(u.href);
  }
  function browserCommand(raw) {
    const [cmd, ...rest] = String(raw).trim().split(/\s+/);
    const words = rest.join(' ');
    const doc = readerDoc();
    const se = doc && doc.scrollingElement;
    switch ((cmd || '').toLowerCase()) {
      case 'back': if (nav.at > 0) load(nav.list[--nav.at]); break;
      case 'forward': if (nav.at < nav.list.length - 1) load(nav.list[++nav.at]); break;
      case 'reload': if (nav.at >= 0) load(nav.list[nav.at]); break;
      case 'close': closeWindow('browser'); break;
      case 'read': {
        const view = window.wsAvatarContext && window.wsAvatarContext();
        if (view && view.text && voice() && voice().speak) { voice().speak(view.text.slice(0, 900)); if (avatar) avatar.gesture('explain'); }
        break;
      }
      case 'newtab': if (nav.at >= 0) window.open(nav.list[nav.at], '_blank', 'noopener'); break;
      case 'zoomin': case 'zoomout':
        nav.zoom = Math.max(0.6, Math.min(2, nav.zoom + (cmd.toLowerCase() === 'zoomin' ? 0.15 : -0.15)));
        if (doc) doc.documentElement.style.zoom = String(nav.zoom);
        break;
      case 'down': case 'up': case 'top': case 'bottom':
        if (se) se.scrollTo({ top: { down: se.scrollTop + se.clientHeight * 0.8, up: se.scrollTop - se.clientHeight * 0.8, top: 0, bottom: se.scrollHeight }[cmd.toLowerCase()], behavior: reduced() ? 'auto' : 'smooth' });
        break;
      case 'find': {
        if (!doc || !words) break;
        doc.querySelectorAll('mark.avatar-found').forEach((m) => m.replaceWith(...m.childNodes));
        const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
        const want = words.toLowerCase();
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const i = n.nodeValue.toLowerCase().indexOf(want);
          if (i < 0) continue;
          const r = doc.createRange(); r.setStart(n, i); r.setEnd(n, i + words.length);
          const mark = doc.createElement('mark'); mark.className = 'avatar-found';
          r.surroundContents(mark);
          mark.scrollIntoView({ block: 'center' });
          break;
        }
        break;
      }
      case 'click': {
        if (!doc || !words) break;
        const want = words.toLowerCase();
        const links = [...doc.querySelectorAll('a[href^="/fragments/reader?u="]')];
        const a = links.find((x) => x.textContent.trim().toLowerCase() === want) || links.find((x) => x.textContent.toLowerCase().includes(want));
        if (a) browse(new URL(a.getAttribute('href'), location.origin).searchParams.get('u'));
        break;
      }
      default: break;
    }
  }
  // What the browser shows, for the assistant with each message: so it can read the page and go on.
  window.wsAvatarContext = () => {
    if (!windows.browser || nav.at < 0) return null;
    const doc = readerDoc();
    if (!doc || !doc.body) return { url: nav.list[nav.at] };
    const se = doc.scrollingElement;
    const blocks = [...doc.body.querySelectorAll('h1, h2, h3, p, li, pre, td')];
    const view = blocks.filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < (se ? se.clientHeight : 600); })
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ').slice(0, 1500);
    const links = [...doc.querySelectorAll('a[href^="/fragments/reader?u="]')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()).filter((t) => t && t.length < 60).slice(0, 30);
    return { title: (doc.title || '').slice(0, 140), url: nav.list[nav.at], scrolled: se ? Math.round((se.scrollTop / Math.max(1, se.scrollHeight - se.clientHeight)) * 100) : 0, text: view, links };
  };
  // One field opens anything: a video link plays, a web address is read, words are searched.
  function openAnything(v) {
    if (!v) return;
    let u = null;
    try { u = new URL(/^[a-z]+:\/\//i.test(v) ? v : (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? `https://${v}` : '')); } catch (_) { u = null; }
    const yt = u && (u.hostname.replace(/^www\.|^m\./, '') === 'youtu.be' ? u.pathname.slice(1, 12)
      : /(^|\.)youtube\.com$/.test(u.hostname) ? (u.searchParams.get('v') || '') : '');
    if (yt && /^[\w-]{11}$/.test(yt)) showVideo(yt);
    else if (u) browse(u.href);
    else search(v);
  }

  // A web search, read through the same reader: DuckDuckGo's plain results, each one opened in the window.
  const search = (words) => browse(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(words).slice(0, 160))}`);

  // ---- The robot button's menu: show or hide, the board, the open windows, settings ---------------
  const micBtn = dock.querySelector('.dock-talk');
  const keepBtn = dock.querySelector('.dock-mic');
  const pops = bar.querySelector('.assistant-avatar-pops');
  const MIC = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>';
  micBtn.querySelector('.dock-talk-icon').innerHTML = svg(MIC, 20);
  keepBtn.innerHTML = vi('headset');
  // The menu's tool buttons carry the dashboard's own Tabler icons, drawn by the server with the rest of the header.
  // Its settings, kept per browser on the hub domain: how big it is, whether it wanders, where it stands.
  const SIZES = { small: 'Small', medium: 'Medium', large: 'Large', xl: 'Very big', huge: 'Huge' };
  const SIZE_ORDER = Object.keys(SIZES);
  const applySize = () => { floatCard.dataset.size = SIZES[getPref('ws-avatar-size', 'medium')] ? getPref('ws-avatar-size', 'medium') : 'medium'; };
  // A size by name, or a step bigger or smaller; it keeps its feet where they were, inside the page.
  function resize(to) {
    const now = SIZE_ORDER.indexOf(floatCard.dataset.size || 'medium');
    const next = to === 'bigger' ? SIZE_ORDER[Math.min(SIZE_ORDER.length - 1, now + 1)] : to === 'smaller' ? SIZE_ORDER[Math.max(0, now - 1)] : to;
    if (!SIZES[next]) return;
    const before = floatCard.getBoundingClientRect();
    pref('ws-avatar-size', next);
    // The new size at once (no transition), so it can be measured now, and then it flies to stay inside the
    // page with its feet where they were. Waiting for a size transition to end is not reliable on a busy machine.
    floatCard.classList.add('is-sizing');
    applySize();
    const after = floatCard.getBoundingClientRect();
    floatCard.classList.remove('is-sizing');
    flyTo(before.left, before.bottom - after.height);
    if (avatar) avatar.gesture(SIZE_ORDER.indexOf(next) > now ? 'cheer' : 'nod');
  }
  const wanders = () => getPref('ws-avatar-wander', '1') === '1';
  // The voices: the browser's own (free), and the ElevenLabs voices of the account once the Workspace has
  // its key (listing is free; each reply spoken in one spends credits, which the group's label says).
  let eleven = null;
  const loadEleven = () => {
    if (eleven) return;
    eleven = { voices: [] };
    fetch('/fragments/assistant/voices', { headers: { Accept: 'application/json' } }).then((r) => r.json())
      .then((d) => { eleven = d && Array.isArray(d.voices) ? d : { voices: [] }; if (openPop === 'settings') renderPop('settings'); })
      .catch(() => { /* the browser's voices are still there */ });
  };
  function voiceOptions() {
    const current = (voice() && voice().get && voice().get('voiceName')) || '';
    const opt = (value, label) => `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
    const own = (window.speechSynthesis ? speechSynthesis.getVoices() : []).map((vo) => opt(vo.name, `${vo.name} (${vo.lang})`)).join('');
    const paid = eleven && eleven.voices.length
      ? `<optgroup label="ElevenLabs (spends credits)">${eleven.voices.map((v) => opt(`elevenlabs:${v.id}`, v.label ? `${v.name} (${v.label})` : v.name)).join('')}</optgroup>` : '';
    return `${opt('', 'The best free voice')}${own ? `<optgroup label="This browser (free)">${own}</optgroup>` : ''}${paid}`;
  }
  // Hair colours offered: the brand's own first, then everyday ones.
  const HAIR = [['#0074e0', 'Brand blue'], ['#2b447c', 'Brand navy'], ['#1f2937', 'Black'], ['#6b4226', 'Brown'],
    ['#c9a26b', 'Blond'], ['#9ca3af', 'Grey'], ['', 'As the model came']];
  const setHair = (hex) => {
    const me = who(); pref(`ws-avatar-hair-${me.id}`, hex);
    const c = coloursOf(me); delete c.Hair; saveColours(me, c);
    if (avatar && avatar.setHair) avatar.setHair(hex || me.hair || '');
  };
  let openPop = '';
  function renderPop(name) {
    if (name === 'settings') loadEleven();
    if (name === 'windows') {
      const open = Object.keys(windows);
      pops.innerHTML = open.length
        ? `<ul class="avatar-kit-list">${open.map((k) => `<li><span>${windows[k].getAttribute('aria-label') || k}</span><button type="button" class="avatar-chip" data-front="${k}">Show</button><button type="button" class="avatar-chip" data-close="${k}">Close</button></li>`).join('')}</ul>`
        : '<p class="avatar-kit-empty">No windows are open. The board, a video or a page open here when the avatar or you open them.</p>';
    } else if (name === 'settings') {
      const size = floatCard.dataset.size || 'medium';
      const me = who();
      pops.innerHTML = `<div class="avatar-kit-settings">
        ${cast.avatars.length > 1 ? `<label class="avatar-kit-range"><span>Avatar</span><select data-avatar-who aria-label="Avatar">${cast.avatars.map((a) => `<option value="${esc(a.id)}"${a.id === me.id ? ' selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>` : ''}
        ${me.credit ? `<p class="avatar-kit-credit">${esc(me.credit)}</p>` : ''}
        ${avatar && avatar.colourParts ? `<div class="avatar-kit-colours" role="group" aria-label="Colours"><span>Colours</span><div>${avatar.colourParts().map(({ part, hex }) => `<label class="avatar-kit-colour"><input type="color" data-part="${esc(part)}" value="${esc(hex)}" aria-label="${esc(part)} colour"><span>${esc(part)}</span></label>`).join('')}</div><button type="button" class="avatar-chip" data-colours-reset>Original colours</button></div>` : ''}
        ${avatar && avatar.hasHair ? `<div role="group" aria-label="Hair colour"><span>Hair</span>${HAIR.map(([c, l]) => `<button type="button" class="avatar-swatch" data-hair="${c}" title="${l}" aria-label="${l}" aria-pressed="${hairOf(me) === c}" style="background:${c || 'transparent'}">${c ? '' : '×'}</button>`).join('')}<input type="color" data-hair-pick value="${hairOf(me) || '#0074e0'}" aria-label="Any hair colour" title="Any colour"></div>` : ''}
        <div role="group" aria-label="Look"><span>Look</span>${[['2d', '2D'], ['3d', '3D']].map(([k, l]) => `<button type="button" class="avatar-chip" data-look="${k}" aria-pressed="${lookPref() === k}">${l}</button>`).join('')}</div>
        <div role="group" aria-label="Size"><span>Size</span>${Object.entries(SIZES).map(([k, l]) => `<button type="button" class="avatar-chip" data-size="${k}" aria-pressed="${k === size}">${l}</button>`).join('')}</div>
        <div role="group" aria-label="Where it stands"><span>Stand</span>${[['home', 'By the text box'], ['center', 'Center'], ['right', 'Right']].map(([k, l]) => `<button type="button" class="avatar-chip" data-place="${k}">${l}</button>`).join('')}</div>
        <label class="avatar-kit-range"><span>Voice</span><select data-voice-name aria-label="Voice">${voiceOptions()}</select></label>
        <label class="avatar-kit-range"><span>Volume</span><input type="range" min="0" max="1" step="0.05" data-voice="volume" value="${voice() && voice().get ? (voice().get('volume') ?? 1) : 1}" aria-label="Voice volume"></label>
        <label class="avatar-kit-range"><span>Speed</span><input type="range" min="0.5" max="2" step="0.05" data-voice="rate" value="${voice() && voice().get ? (voice().get('rate') ?? 1) : 1}" aria-label="Voice speed"></label>
        <label class="avatar-kit-range"><span>Pitch</span><input type="range" min="0" max="2" step="0.05" data-voice="pitch" value="${voice() && voice().get ? (voice().get('pitch') ?? 1) : 1}" aria-label="Voice pitch"></label>
        <label class="avatar-kit-check"><input type="checkbox" data-wander ${wanders() ? 'checked' : ''}> Move about now and then</label>
        <label class="avatar-kit-check"><input type="checkbox" data-roam ${roams() ? 'checked' : ''}> Roam the whole page, not only by the text box</label>
      </div>`;
    } else pops.innerHTML = '';
  }
  // The board opens in a window of its own, so the menu steps out of its way.
  const closeMenu = () => { try { if (window.UIkit) window.UIkit.dropdown(bar).hide(false); } catch (_) { /* no menu to close */ } };
  function setPop(name) {
    openPop = openPop === name ? '' : name;
    bar.querySelectorAll('[data-pop]').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.pop === openPop)));
    renderPop(openPop);
  }
  bar.addEventListener('click', (e) => {
    const lk = e.target.closest('[data-look]');
    if (lk) { pref('ws-avatar-look', lk.dataset.look); if (avatar && avatar.setLook) avatar.setLook(lk.dataset.look); renderPop('settings'); return; }
    if (e.target.closest('[data-colours-reset]')) {
      const me = who(); const c = coloursOf(me);
      for (const part of Object.keys(c)) if (avatar) avatar.setColour(part, '');
      saveColours(me, {}); pref(`ws-avatar-hair-${me.id}`, '');
      if (avatar && me.hair) avatar.setHair(me.hair);
      renderPop('settings'); return;
    }
    const h = e.target.closest('[data-hair]');
    if (h) { setHair(h.dataset.hair); renderPop('settings'); return; }
    const b = e.target.closest('[data-pop], [data-kit], [data-front], [data-close], [data-size], [data-place]');
    if (!b) return;
    if (b.dataset.pop) setPop(b.dataset.pop);
    else if (b.dataset.kit === 'board') { closeMenu(); board(); if (avatar) avatar.gesture('explain'); }
    else if (b.dataset.front) { const w = windows[b.dataset.front]; if (w) { document.body.appendChild(w); w.focus?.(); } }
    else if (b.dataset.close) { closeWindow(b.dataset.close); renderPop('windows'); }
    else if (b.dataset.size) { resize(b.dataset.size); renderPop('settings'); }
    else if (b.dataset.place) place(b.dataset.place);
  });
  bar.addEventListener('change', (e) => {
    if (e.target.matches('[data-wander]')) pref('ws-avatar-wander', e.target.checked ? '1' : '0');
    if (e.target.matches('[data-hair-pick]')) { setHair(e.target.value); renderPop('settings'); }
    if (e.target.matches('[data-roam]')) { pref('ws-avatar-roam', e.target.checked ? '1' : '0'); if (!e.target.checked) place('home'); }
  });
  // A part's colour, live as the picker moves, and kept.
  bar.addEventListener('input', (e) => {
    if (!e.target.matches('[data-part]') || !avatar) return;
    const me = who(); const c = coloursOf(me);
    c[e.target.dataset.part] = e.target.value; saveColours(me, c);
    avatar.setColour(e.target.dataset.part, e.target.value);
  });
  bar.addEventListener('input', (e) => { if (e.target.matches('[data-voice]') && voice() && voice().set) voice().set(e.target.dataset.voice, e.target.value); });
  bar.addEventListener('change', (e) => {
    if (!e.target.matches('[data-avatar-who]')) return;
    pref('ws-avatar-who', e.target.value);
    if (avatar) { avatar.dispose(); avatar = null; stage.classList.remove('is-ready'); }
    if (root.classList.contains('assistant-avatar-on')) mount(true);
    renderPop('settings');
  });
  bar.addEventListener('change', (e) => {
    if (!e.target.matches('[data-voice-name]') || !voice() || !voice().set) return;
    pref(`ws-voice-name-${who().id}`, e.target.value);
    voice().set('voiceName', e.target.value);
    if (voice().speak) voice().speak('This is how I sound now.');
  });

  // Talk, as in the avatar app. Hold the big button, or hold the Space bar anywhere you are not typing:
  // what you say is sent when you let go. Or keep listening with the round mic: each sentence is sent as
  // you finish it, until you press it again. The browser's speech recognition, in the assistant's own
  // language setting; the buttons go when the browser has none.
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { micBtn.hidden = true; keepBtn.hidden = true; }
  const lang = () => (window.WS_SPEECH && window.WS_SPEECH.speechToText && window.WS_SPEECH.speechToText.webSpeech && window.WS_SPEECH.speechToText.webSpeech.language) || 'en-US';
  let rec = null; let heard = ''; let keep = false;
  const markListening = (on) => {
    [floatCard, layer].forEach((el) => el.classList.toggle('is-listening', on));
    micBtn.classList.toggle('is-held', on && !keep);
  };
  function listen(on) {
    if (!Recognition || keep) return;
    if (on && !rec) {
      heard = '';
      if (voice()) voice().cancel();
      rec = new Recognition();
      rec.lang = lang();
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (ev) => { heard = [...ev.results].map((r) => r[0].transcript).join(' ').trim(); };
      rec.onend = () => { if (rec) finish(); };
      try { rec.start(); } catch (_) { rec = null; return; }
      markListening(true);
      if (avatar) avatar.gesture('look');
    } else if (!on && rec) {
      try { rec.stop(); } catch (_) { finish(); }
    }
  }
  function finish() {
    rec = null;
    markListening(false);
    if (heard) { send(heard); if (avatar) avatar.gesture('nod'); }
    heard = '';
  }
  // Keep listening: every final sentence is sent; recognition restarts when the browser ends it.
  let keepRec = null;
  function keepListening(on) {
    keep = on;
    keepBtn.setAttribute('aria-pressed', String(on));
    keepBtn.classList.toggle('is-listening', on);
    [floatCard, layer].forEach((el) => el.classList.toggle('is-listening', on));
    if (!on) { if (keepRec) { const r = keepRec; keepRec = null; try { r.stop(); } catch (_) { /* already stopped */ } } return; }
    if (voice()) voice().cancel();
    const start = () => {
      if (!keep) return;
      const r = keepRec = new Recognition();
      r.lang = lang();
      r.continuous = true;
      r.interimResults = false;
      r.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (!ev.results[i].isFinal) continue;
          const text = ev.results[i][0].transcript.trim();
          // Not while the assistant is speaking: it would hear itself.
          if (text && !(window.speechSynthesis && window.speechSynthesis.speaking)) { send(text); if (avatar) avatar.gesture('nod'); }
        }
      };
      r.onend = () => { if (keep && keepRec === r) setTimeout(start, 250); };
      r.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { keepListening(false); keepBtn.classList.add('is-blocked'); } };
      try { r.start(); } catch (_) { /* started already */ }
    };
    start();
  }
  keepBtn.addEventListener('click', () => keepListening(!keep));
  micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); listen(true); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => micBtn.addEventListener(ev, () => listen(false)));
  micBtn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); listen(true); } });
  micBtn.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') listen(false); });
  // The Space bar anywhere on the page, unless you are typing or pressing a button with it.
  const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.tagName === 'DEEP-CHAT' || el.closest?.('.avatar-note, [contenteditable="true"]'));
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || keep || root.classList.contains('assistant-closed') || typing(document.activeElement)) return;
    e.preventDefault();
    listen(true);
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space' && rec) { e.preventDefault(); listen(false); } });

  // ---- Quick replies: answer in one click ------------------------------------------------------
  function send(text) {
    const chat = document.getElementById('ws-deep-chat');
    if (chat && typeof chat.submitUserMessage === 'function') chat.submitUserMessage({ text });
  }
  let chipsTimer = null;
  function flashChips() {
    chips.hidden = false;
    clearTimeout(chipsTimer);
    chipsTimer = setTimeout(() => { if (!video && !chips.matches(':hover, :focus-within')) chips.hidden = true; }, 20000);
  }
  function paintChips() {
    const words = ['Yes', 'No', 'Next', 'Continue'];
    let html = words.map((w) => `<button type="button" class="avatar-chip" data-say="${w}">${w}</button>`).join('');
    if (video) {
      html += `<button type="button" class="avatar-chip avatar-chip-media" data-media="pause">${video.paused ? 'Play' : 'Pause'}</button>`
        + '<button type="button" class="avatar-chip avatar-chip-media" data-media="forward">+10 s</button>'
        + '<button type="button" class="avatar-chip avatar-chip-media" data-media="quieter">Quieter</button>'
        + `<button type="button" class="avatar-chip avatar-chip-media" data-media="loop" aria-pressed="${video.loop}">Loop</button>`;
    }
    chips.innerHTML = html;
  }
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.say) { send(b.dataset.say); chips.hidden = true; return; }
    if (!video) return;
    controlVideo(b.dataset.media === 'pause' ? 'toggle' : b.dataset.media);
  });

  // ---- Showing and hiding ------------------------------------------------------------------------
  function show() {
    root.classList.add('assistant-avatar-on');
    pref('ws-assistant-avatar', '1');
    paintToggle(true);
    paintMute();
    popOut();
    mount(true);
  }
  // Hidden means silent: the voice stops, its windows close, and the scene is let go.
  function hide() {
    root.classList.remove('assistant-avatar-on');
    pref('ws-assistant-avatar', '0');
    paintToggle(false);
    if (voice()) voice().cancel();
    keepListening(false);
    Object.keys(windows).forEach(closeWindow);
    video = null;
    queue.forEach(clearTimeout);
    if (avatar) { avatar.dispose(); avatar = null; }
    stage.classList.remove('is-ready');
    popIn();
  }

  toggle.addEventListener('click', () => (root.classList.contains('assistant-avatar-on') ? hide() : show()));
  mute.addEventListener('click', () => {
    const v = voice();
    if (!v) return;
    v.setOn(!v.isOn());
    paintMute();
    if (avatar) avatar.gesture(v.isOn() ? 'nod' : 'shrug');
  });

  // ---- What the assistant does ------------------------------------------------------------------
  // The request says whether the avatar is shown, so the assistant only writes its lines when it is.
  window.wsAssistantAvatarOn = () => root.classList.contains('assistant-avatar-on');
  // ---- The agent's status, as the Claude Code CLI shows it: a spinner, a verb and the time so far -------
  // While a reply is on its way the bubble over the avatar cycles through what an agent does, and the
  // avatar acts each one out: any avatar, since the moves are shared. When the reply comes it says Done
  // with a thumbs up; when the request fails, Stopped with a shrug.
  const STATUSES = [
    ['Thinking', 'think'], ['Pondering', 'look'], ['Tempering', 'hammer'], ['Searching', 'scan'],
    ['Brewing', 'stir'], ['Coding', 'type'], ['Reading', 'scan'], ['Crafting', 'hammer'],
  ];
  const SPIN = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
  const status = document.createElement('div');
  status.className = 'avatar-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;
  status.innerHTML = '<span class="avatar-status-spin" aria-hidden="true"></span><span class="avatar-status-verb"></span><span class="avatar-status-time"></span>';
  floatCard.appendChild(status);
  const statusSpin = status.querySelector('.avatar-status-spin');
  const statusVerb = status.querySelector('.avatar-status-verb');
  const statusTime = status.querySelector('.avatar-status-time');
  let statusTimer = null; let statusHide = null; let since = 0; let step = 0;
  function startStatus() {
    clearTimeout(statusHide); clearInterval(statusTimer);
    since = Date.now(); step = 0;
    status.hidden = false; status.classList.remove('is-done', 'is-stopped');
    let n = Math.floor(Math.random() * STATUSES.length); let tick = 0;
    const next = () => {
      const [verb, move] = STATUSES[n % STATUSES.length]; n += 1;
      statusVerb.textContent = `${verb}…`;
      if (avatar && !reduced()) avatar.gesture(move);
    };
    next();
    statusTimer = setInterval(() => {
      tick += 1;
      statusSpin.textContent = SPIN[(step += 1) % SPIN.length];
      statusTime.textContent = `${Math.round((Date.now() - since) / 1000)}s`;
      if (tick % 32 === 0) next();   // a new verb and its move every 4 s
    }, 125);
  }
  function stopStatus(failed) {
    clearInterval(statusTimer);
    if (status.hidden) return;
    statusSpin.textContent = failed ? '■' : '✓';
    statusVerb.textContent = failed ? 'Stopped' : 'Done';
    statusTime.textContent = `${Math.round((Date.now() - since) / 1000)}s`;
    status.classList.add(failed ? 'is-stopped' : 'is-done');
    if (avatar) avatar.gesture(failed ? 'shrug' : 'thumbsup');
    statusHide = setTimeout(() => { status.hidden = true; }, 3500);
  }
  document.addEventListener('ws-assistant-working', (e) => {
    if (!avatar) return;
    if (e.detail && e.detail.on) startStatus(); else stopStatus(Boolean(e.detail && e.detail.failed));
  });
  document.addEventListener('ws-assistant-reply', (e) => {
    if (!root.classList.contains('assistant-avatar-on')) return;
    const d = (e.detail && e.detail.directive) || {};
    if (avatar) avatar.setThinking(false);
    if (d.move) place(d.move);
    if (d.size) resize(d.size);
    lastActivity = Date.now();
    if (d.board) write(d.board);
    if (d.draw) draw(d.draw);
    if (d.show && d.show.video) showVideo(d.show.video);
    if (d.browse) browse(d.browse);
    for (const c of d.browseCommands || []) browserCommand(c);
    for (const c of d.videoCommands || []) controlVideo(c);
    if (d.search) search(d.search);
    const moves = d.gestures && d.gestures.length ? d.gestures
      : [d.navigate || d.open || d.browse ? 'point' : d.draw || d.board ? 'explain' : e.detail && e.detail.voice ? 'explain' : 'nod'];
    play(moves);
    flashChips();
  });
  document.addEventListener('ws-assistant-speech', (e) => {
    if (!avatar || !e.detail) return;
    if (e.detail.type === 'start') avatar.setSpeaking(true);
    else if (e.detail.type === 'word') { avatar.setSpeaking(true); avatar.word(e.detail.word); }
    else avatar.setSpeaking(false);
  });
  // Some voices never say where each word is: the mouth then keeps a gentle rhythm while they speak.
  setInterval(() => {
    if (avatar && window.speechSynthesis && window.speechSynthesis.speaking) avatar.word('abcde'.charAt(Math.floor(Math.random() * 5)));
  }, 220);

  const on = root.classList.contains('assistant-avatar-on');
  paintToggle(on);
  paintMute();
  paintChips();
  if (on) { popOut(); mount(false); }
})();
