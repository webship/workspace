/**
 * The screen terminals: one xterm per window, several windows at once.
 *
 * This used to be an inline script inside a server template literal, mounting ONE terminal against
 * fixed element ids — `browser-term`, `term-status`, `term-fullscreen`. That is why only one session
 * could be open: a second terminal's script found the first one's elements, wired its socket to them
 * and left the two fighting over one status line. Everything here is scoped to the element it was
 * given, so N windows coexist and none of them knows the others exist.
 *
 * It is a real file for a second reason. The old script travelled through a template literal, where a
 * backtick in a comment ends the literal and takes the whole app down, and every backslash is one more
 * thing to get wrong — the comments in it said so. Here a regex is a regex.
 *
 * What a window owns: an xterm, a WebSocket to /ws/screen/<session>, its own place on the screen, and
 * the cleanup for all of it. A window that leaves the DOM closes its socket — otherwise closing it
 * would leave the PTY and the `screen -x` client behind, one per terminal anybody ever opened.
 *
 * **They are windows, not a modal.** A modal is one thing at a time, in the middle, with the page
 * behind it out of reach — which is the opposite of what watching a terminal is for: you open one to
 * keep half an eye on it while you do something else, and two of them to watch two agents. So each
 * terminal floats, is dragged by its title bar, resizes from its corner, and remembers where it was
 * put. `Arrange` tidies them all at once — down the screen as a list, or tiled as a grid — because
 * free-floating windows are worth exactly nothing once there are four of them and no way to line them
 * up. Geometry is per browser, like the theme, and clamped back into the viewport on every apply, so a
 * window dragged to the edge of a wide screen is still reachable on a narrow one.
 */

(function terminals() {
  const XTERM = [
    ['Terminal', '/vendor/xterm/xterm.js'],
    ['FitAddon', '/vendor/xterm/addon-fit.js'],
    ['WebLinksAddon', '/vendor/xterm/addon-web-links.js'],
    ['Unicode11Addon', '/vendor/xterm/addon-unicode11.js'],
  ];

  /**
   * The vendored xterm bundle, loaded once however many windows ask for it at the same moment.
   *
   * Unversioned paths: these are vendored files that change when the library is upgraded, and the
   * static server gives them a validator, so the cost of not versioning them is one 304.
   */
  function loadXterm() {
    if (window.__xtermLoading) return window.__xtermLoading;
    const need = XTERM.filter(([global]) => !window[global]).map(([, src]) => src);
    // The face is waited for too: xterm measures a character the moment it opens, and measuring a
    // fallback font puts every column in the wrong place until something forces a re-fit.
    const fontsReady = () => (document.fonts && document.fonts.load
      ? Promise.all(['400', '700'].map((w) => document.fonts.load(`${w} ${FONT_DEFAULT}px "Ubuntu Mono"`))).catch(() => {})
      : Promise.resolve());
    if (!need.length) return fontsReady();
    window.__xtermLoading = Promise.all(need.map((src) => new Promise((ok, no) => {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) { existing.addEventListener('load', ok); existing.addEventListener('error', no); return; }
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = no;
      document.head.appendChild(s);
    }))).then(fontsReady).catch((err) => { window.__xtermLoading = null; throw err; });
    return window.__xtermLoading;
  }

  // xterm paints its own canvas and cannot read a CSS variable, so it is handed the value the token
  // resolves to. The fallbacks are xterm's own defaults, used only if the stylesheet has not loaded.
  const cssVar = (name, fallback) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  /**
   * How a terminal LOOKS: the face, the size and the palette, kept per browser like the theme.
   *
   * Ubuntu is the default because it is the terminal people are used to: aubergine, Ubuntu Mono, the
   * Tango palette. The others are the ones the GNOME terminal's own list offers, and Dashboard follows
   * the dashboard's style. A palette is named here rather than in a stylesheet because xterm paints a
   * canvas and cannot read a CSS variable; the window's own chrome gets the same values as custom
   * properties, set below, so the two cannot disagree.
   */
  const TERM_FONT = '"Ubuntu Mono", "Ubuntu Sans Mono", "DejaVu Sans Mono", "JetBrains Mono", ui-monospace, Menlo, monospace';
  const FONT_KEY = 'ws-term-font';
  const STYLE_KEY = 'ws-term-style';
  const FONT_MIN = 11;
  const FONT_MAX = 32;
  const FONT_DEFAULT = 17;
  const ANSI_KEYS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];
  const TANGO = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
    '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];
  const TERM_STYLES = {
    ubuntu: { bg: '#300a24', fg: '#ffffff', bar: '#2c001e', barInk: '#eeeeec', cursor: '#ffffff', select: 'rgba(255,255,255,.28)', ansi: TANGO },
    tango: {
      bg: '#fdfdfb', fg: '#2e3436', bar: '#e8e6e3', barInk: '#2e3436', cursor: '#2e3436', select: 'rgba(52,101,164,.28)',
      ansi: ['#2e3436', '#cc0000', '#3a7a04', '#9c7a00', '#3465a4', '#75507b', '#06808a', '#8a8f87',
        '#555753', '#d92020', '#4e9a06', '#b58b00', '#3a6fb5', '#8f5f96', '#0a8f95', '#2e3436'],
    },
    solarized: {
      bg: '#002b36', fg: '#839496', bar: '#073642', barInk: '#93a1a1', cursor: '#93a1a1', select: 'rgba(147,161,161,.28)',
      ansi: ['#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
        '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'],
    },
    dracula: {
      bg: '#282a36', fg: '#f8f8f2', bar: '#21222c', barInk: '#f8f8f2', cursor: '#f8f8f2', select: 'rgba(98,114,164,.5)',
      ansi: ['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
        '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'],
    },
  };
  const STYLE_ORDER = ['ubuntu', 'tango', 'solarized', 'dracula', 'dashboard'];

  /** The palette of a style. `dashboard` is read from the tokens, so it follows the page's style. */
  function styleOf(name) {
    if (name === 'dashboard') {
      const bg = cssVar('--code-bg', '#1f2437');
      return { bg, fg: cssVar('--code-ink', '#e6e9f5'), bar: cssVar('--surface', bg), barInk: cssVar('--text-default', '#e6e9f5'),
        cursor: cssVar('--terminal-ink', '#c9f7d4'), select: 'rgba(255,255,255,.25)', ansi: TANGO };
    }
    return TERM_STYLES[name] || TERM_STYLES.ubuntu;
  }

  function lookNow() {
    let style = 'ubuntu';
    let size = FONT_DEFAULT;
    try {
      const s = localStorage.getItem(STYLE_KEY);
      if (STYLE_ORDER.includes(s)) style = s;
      const n = parseInt(localStorage.getItem(FONT_KEY), 10);
      if (n >= FONT_MIN && n <= FONT_MAX) size = n;
    } catch (_) { /* private window: the defaults */ }
    return { style, size };
  }

  function xtermTheme(name) {
    const s = styleOf(name);
    const t = { background: s.bg, foreground: s.fg, cursor: s.cursor, cursorAccent: s.bg, selectionBackground: s.select };
    ANSI_KEYS.forEach((k, i) => { t[k] = s.ansi[i]; });
    return t;
  }

  /** Bring up one window: its terminal, its socket, and the cleanup for both. */
  function mount(pane) {
    if (pane.dataset.up) return;
    const session = pane.dataset.session;
    if (!session) return;
    pane.dataset.up = '1';

    const el = pane.querySelector('.term-screen');
    const status = pane.querySelector('.term-status');
    const again = pane.querySelector('.term-reconnect');
    const say = (text) => { if (status) status.textContent = text; };

    const look = lookNow();
    const term = new window.Terminal({
      fontSize: look.size,
      cursorBlink: true,
      // Zero, and measured rather than assumed: `screen` keeps its client on the ALTERNATE buffer
      // whatever is running inside it — a plain bash session reports `buffer.active.type` as
      // "alternate" with `baseY: 0` after 120 lines of output. So nothing ever scrolls off into
      // xterm's own scrollback and a buffer here would hold nothing while costing memory. The
      // scrollback that exists is screen's, and copy mode is the way into it — see copyMode below.
      scrollback: 0,
      allowProposedApi: true,
      fontFamily: TERM_FONT,
      fontWeightBold: '700',
      // xterm paints its own canvas, so it is told the palette of the chosen style, which the window's
      // own chrome gets too (paintLook).
      theme: xtermTheme(look.style),
    });
    paintChrome(pane, look.style);

    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    const refit = () => {
      try { fit.fit(); } catch (_) { /* not visible yet */ }
      // The session has to be told, or it goes on painting for the width it was attached at.
      if (pane.__resized) pane.__resized();
    };

    // Correct widths for the emoji and box drawing a TUI paints with, and clickable URLs — each
    // wrapped, because an addon must never stop the terminal opening.
    try {
      if (window.Unicode11Addon) {
        term.loadAddon(new window.Unicode11Addon.Unicode11Addon());
        term.unicode.activeVersion = '11';
      }
    } catch (_) { /* widths stay at version 6 */ }
    try {
      if (window.WebLinksAddon) {
        term.loadAddon(new window.WebLinksAddon.WebLinksAddon((event, uri) => {
          window.open(uri, '_blank', 'noopener,noreferrer');
        }));
      }
    } catch (_) { /* links stay plain text */ }

    term.open(el);
    refit();
    // What a character actually costs here, learned once and reused for every window opened after.
    measureCell(term);
    // A window that opened too narrow for 80 columns is widened once, now that the real cell size is
    // known — unless its geometry was REMEMBERED, in which case it is the size somebody chose and not
    // this file's business.
    if (!pane.dataset.geom && term.cols < defaultPreset().cols) {
      const want = fitsSize();
      const r = pane.getBoundingClientRect();
      if (want.w > r.width && want.w <= window.innerWidth) place(pane, r.left, r.top, want.w, Math.max(r.height, want.h));
    }
    window.addEventListener('resize', refit);
    // The terminal follows its box: a window is dragged, resized and tiled, so one that kept its first
    // size would waste half of a wide one and clip a narrow one.
    if (window.ResizeObserver) new ResizeObserver(refit).observe(pane);

    // Scrolling back, through screen's own scrollback — the only one there is.
    //
    // Four things had to be true at once, and each was found by driving a real session:
    //
    //   1. xterm cannot hold the scrollback itself. screen keeps its client on the ALTERNATE buffer
    //      whatever runs inside it, so nothing ever scrolls off into xterm (measured: baseY stays 0
    //      after 300 lines). That is why `scrollback: 0` above is right rather than stingy.
    //   2. screen's copy mode is the way in: Ctrl-A then Esc answers
    //      "Copy mode - Column 31 Line 24(+1024)" — a thousand lines are sitting there.
    //   3. An ARROW KEY ABORTS IT. The arrow sequence starts with Esc, and Esc in copy mode means
    //      abort, so the obvious implementation opens copy mode and closes it again in one gesture —
    //      and then types the rest of the sequence into the shell. That is what made this look
    //      impossible, and it is why the first attempt was reverted rather than shipped.
    //   4. So the movement keys are screen's own, which are plain characters: Ctrl-U and Ctrl-D for
    //      half a page. `k` and `j` exist too, but they walk the cursor down the visible screen first
    //      and only scroll once it reaches the edge, which is not what a wheel notch should feel like.
    const HALF_UP = String.fromCharCode(21);      // Ctrl-U
    const HALF_DOWN = String.fromCharCode(4);     // Ctrl-D
    const enterCopyMode = () => { send(String.fromCharCode(1)); send(String.fromCharCode(27)); };
    pane.__scrollBack = enterCopyMode;
    el.addEventListener('wheel', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Ctrl and the wheel is the text size, as in every terminal and every browser.
      if (e.ctrlKey) { stepFont(e.deltaY < 0 ? 1 : -1); return; }
      if (!pane.dataset.copyMode) {
        // There is nothing below the last line to reach, so only scrolling UP opens it.
        if (e.deltaY < 0) enterCopyMode();
        return;
      }
      send(e.deltaY < 0 ? HALF_UP : HALF_DOWN);
    }, { capture: true, passive: false });

    /**
     * The socket, and why it is re-opened when the window changes size.
     *
     * The PTY behind it is sized ONCE, by the `stty cols N rows M` the server runs before `screen -x`
     * — there is no resize channel, and every message on this socket goes straight to the session's
     * stdin, so one cannot be added without inventing a protocol a keystroke could collide with.
     *
     * So a resized window re-attaches: xterm re-fits locally, and the new columns and rows reach the
     * session the same way the first ones did. Debounced until the drag settles, and only when the
     * size in CHARACTERS actually changed — dragging a window two pixels wider is not a reason to
     * reconnect, and a reconnect costs a repaint.
     *
     * The session is untouched by any of this: `screen -x` attaches and detaches, and what runs inside
     * it neither stops nor notices beyond being told its window is a different shape.
     */
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    let ws;
    let attachedAt = { cols: 0, rows: 0 };

    const wire = () => {
    attachedAt = { cols: term.cols, rows: term.rows };
    ws = new WebSocket(`${proto}${location.host}/ws/screen/${encodeURIComponent(session)}?cols=${term.cols}&rows=${term.rows}`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => {
      const data = typeof e.data === 'string' ? e.data : new Uint8Array(e.data);
      // Whether the session is in copy mode is SCREEN's answer, read from what it prints — never a
      // flag set hopefully when a key was sent. The first version set it on sending Ctrl-A Esc, which
      // was wrong whenever copy mode did not open, and then every wheel notch typed into the shell.
      const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
      if (/Copy mode aborted/.test(text)) {
        delete pane.dataset.copyMode;
        say(pane.dataset.live ? 'connected' : 'detached');
      } else if (/Copy mode/.test(text)) {
        pane.dataset.copyMode = '1';
        say('scrollback — the wheel moves, q leaves it');
      }
      if (text.length) {
        pane.dataset.painted = '1';
        clearTimeout(pane.__silence);
        if (pane.dataset.live && !pane.dataset.copyMode) say('connected');
      }
      term.write(data);
    };
    ws.onopen = () => {
      say('connected');
      pane.dataset.live = '1';
      // Connected is not the same as painted. `screen -x` attaches to a window whose program may be
      // sitting idle — an agent waiting on an answer, a shell nobody has typed in — and a window that
      // came up with nothing in it looks exactly like one that stalled. The server asks the session to
      // repaint a few times for us; if after that there is still nothing, the window says which of the
      // two it is instead of leaving a black rectangle to be read as broken.
      clearTimeout(pane.__silence);
      pane.__silence = setTimeout(() => {
        if (pane.dataset.painted || !pane.dataset.live) return;
        say('attached — nothing painted yet, press a key or use ↻');
        if (again) again.hidden = false;
      }, 6000);
    };
    ws.onclose = () => {
      // Never write into the terminal to say so — a TUI owns every cell of its screen. And say WHICH
      // of the two happened: a detach leaves the session running, the end of its command does not.
      delete pane.dataset.live;
      delete pane.dataset.painted;
      clearTimeout(pane.__silence);
      if (again) again.hidden = false;
      say('disconnected — checking…');
      fetch(`/fragments/screen-alive/${encodeURIComponent(session)}`)
        .then((r) => r.text())
        .then((alive) => {
          const live = alive.trim() === '1';
          say(live ? 'detached — the session keeps running' : 'the session ended');
          if (!live && again) again.hidden = true;
          if (!live) pane.dataset.ended = '1';
        })
        .catch(() => say('detached'));
    };
    };
    wire();

    // Re-attach at the new size once the resizing has settled.
    let resizeTimer = null;
    const resized = () => {
      if (term.cols === attachedAt.cols && term.rows === attachedAt.rows) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (term.cols === attachedAt.cols && term.rows === attachedAt.rows) return;
        say(`resizing to ${term.cols}×${term.rows}…`);
        // Detach THIS display with screen's own Ctrl-A d before dropping the socket. Closing alone
        // relies on the server reaping the attach, and a client left behind pins the window's size:
        // screen fits a window to every display attached to it.
        try { ws.send(String.fromCharCode(1)); ws.send('d'); } catch (_) { /* already gone */ }
        try { ws.onclose = null; ws.close(); } catch (_) { /* already gone */ }
        wire();
      }, 400);
    };
    pane.__resized = resized;

    // A full-screen program inside screen may turn mouse reporting on (DECSET 1000-1003). screen does
    // not forward those reports to it, so every mouse move would arrive as literal text —
    // "[<35;80;12M" typed into the prompt. Nothing here needs the mouse, so they are dropped.
    const ESC = String.fromCharCode(27);
    const isMouseReport = (s) => s.charAt(0) === ESC && s.charAt(1) === '['
      && (s.charAt(2) === '<' || s.charAt(2) === 'M');
    const send = (d) => { if (!isMouseReport(d) && ws.readyState === 1) ws.send(d); };


    term.onData(send);
    term.onBinary(send);

    // Ctrl and plus, minus or zero: the text size, the way the Ubuntu terminal does it. The browser's
    // own zoom is stopped, because it would scale the whole page instead of the terminal.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); stepFont(1); return false; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); stepFont(-1); return false; }
      if (e.key === '0') { e.preventDefault(); stepFont(0); return false; }
      return true;
    });

    // Focus the window you just opened, and the one you click into — with several open, the terminal
    // that takes your keystrokes must be the one you are looking at, and nothing else says which.
    const focus = () => { try { term.focus(); } catch (_) { /* gone */ } };
    pane.addEventListener('mousedown', focus);
    focus();

    pane.__term = {
      session,
      term,
      refit,
      focus,
      // What the window can put into the session itself, for the controls that are better served by
      // the socket than by an endpoint that cannot reach the host.
      send,
      // Repaint with the current look: the palette, then the face and size, then the grid again.
      look() {
        const now = lookNow();
        term.options.theme = xtermTheme(now.style);
        term.options.fontFamily = TERM_FONT;
        term.options.fontSize = now.size;
        measureCell(term);
        refit();
      },
      close() {
        clearTimeout(resizeTimer);
        try { ws.onclose = null; ws.close(); } catch (_) { /* already gone */ }
        try { term.dispose(); } catch (_) { /* already gone */ }
        window.removeEventListener('resize', refit);
      },
    };
  }

  /**
   * Is this window actually on the screen, with a box xterm can measure?
   *
   * By its RECTANGLE, never by offsetParent: a window is `position: fixed`, and a fixed element's
   * offsetParent is null by definition — so the obvious test reports every terminal as hidden and
   * none of them ever mounts. Measured, not assumed: an unmeasured box gives xterm zero columns.
   */
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  /** Mount every window that is on screen and not up yet. */
  function mountVisible() {
    const pending = [...document.querySelectorAll('.term-window:not([data-up])')].filter(onScreen);
    if (!pending.length) return;
    loadXterm().then(() => pending.forEach(mount)).catch(() => {});
  }

  /** Close one window: its socket, its terminal, and the element. The session keeps running. */
  function closeWindow(win) {
    if (win.__term) win.__term.close();
    win.remove();
    paint();
  }

  /** A window that has left the DOM takes its socket with it, however it went. */
  function reapDetached(root) {
    (root.querySelectorAll ? [...root.querySelectorAll('.term-window')] : [])
      .concat(root.classList && root.classList.contains('term-window') ? [root] : [])
      .forEach((win) => { if (win.__term) win.__term.close(); });
  }

  /* ------------------------------------------------------- windows and layout */

  const LAYOUT_KEY = 'ws-term-layout';
  const GEOM_KEY = 'ws-term-windows';
  const MIN_W = 420;
  const MIN_H = 220;
  let topZ = 40;

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || 'null') || fallback; } catch (_) { return fallback; }
  };
  const writeJson = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private window */ }
  };

  const layoutNow = () => (localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list');

  /** The layer every terminal window lives in, made on first use. */
  function layer() {
    let el = document.getElementById('term-windows');
    if (!el) {
      el = document.createElement('div');
      el.id = 'term-windows';
      document.body.appendChild(el);
    }
    return el;
  }

  const windows = () => [...document.querySelectorAll('.term-window')];

  /**
   * Put a window somewhere, kept inside the viewport.
   *
   * A strip of the title bar always stays on screen: a window dragged off the bottom of a tall display
   * and reopened on a laptop would otherwise be gone, with its terminal still running.
   */
  function place(win, x, y, w, h) {
    const width = Math.max(MIN_W, Math.round(w || win.offsetWidth || 720));
    const height = Math.max(MIN_H, Math.round(h || win.offsetHeight || 420));
    const maxX = Math.max(0, window.innerWidth - Math.min(width, 120));
    const maxY = Math.max(0, window.innerHeight - 44);
    const top = Math.min(Math.max(0, Math.round(y)), maxY);
    win.style.width = `${Math.min(width, window.innerWidth)}px`;
    // Never taller than the room under its top edge: a larger text size makes the default 43 rows
    // taller than many displays, and a window that opens with its bottom row off the screen hides
    // exactly the line a prompt sits on.
    win.style.height = `${Math.max(MIN_H, Math.min(height, window.innerHeight - top - 8))}px`;
    win.style.left = `${Math.min(Math.max(0, Math.round(x)), maxX)}px`;
    win.style.top = `${top}px`;
    if (win.__term) win.__term.refit();
  }

  const geomOf = (win) => {
    const r = win.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };

  function remember(win) {
    win.dataset.geom = '1';          // it has a size somebody chose now
    const all = readJson(GEOM_KEY, {});
    all[win.dataset.session] = geomOf(win);
    writeJson(GEOM_KEY, all);
  }

  /** Bring one to the front, and mark it as the one taking keystrokes. */
  function raise(win) {
    topZ += 1;
    win.style.zIndex = String(topZ);
    windows().forEach((w) => w.classList.toggle('is-front', w === win));
  }

  /**
   * Where a newly opened window goes when it has never been placed.
   *
   * Cascaded from the top left of the work area rather than centred: a new window centred on top of
   * the last one hides it completely, and two terminals that look like one is the failure this whole
   * change is about.
   */
  function cascade(n) {
    const want = fitsSize();
    const w = Math.min(Math.max(want.w, Math.round(window.innerWidth * 0.52)), Math.round(window.innerWidth * 0.94));
    const h = Math.min(Math.max(want.h, Math.round(window.innerHeight * 0.55)), Math.round(window.innerHeight * 0.9));
    const step = 28;
    return { x: 40 + (n % 6) * step, y: 70 + (n % 6) * step, w, h };
  }

  /**
   * The sizes a terminal window can be, in CHARACTERS — the same four the GNOME/Ubuntu terminal offers.
   *
   * A terminal is measured in columns and rows, not pixels: 132x43 means something to anyone who has
   * used a terminal, and "914 by 741" means nothing. These four are what Ubuntu's own profile presets
   * are, so the list is a familiar one rather than a set somebody here invented.
   *
   * 80x24 is the floor, not the default. It is what every TUI assumes and so the smallest size that is
   * not actively broken — but it is cramped for a build log or an agent's output, which is most of what
   * these windows hold.
   */
  const PRESETS = [
    { cols: 80, rows: 24 },
    { cols: 80, rows: 43 },
    { cols: 132, rows: 24 },
    { cols: 132, rows: 43 },
  ];

  /**
   * What a window must measure to hold that many characters.
   *
   * From a MEASURED cell, because the font is the user's monospace stack at whatever size the browser
   * gives it — a character's width is not something this file can know. `cellSize` is filled in by the
   * first window to render and reused after that; before any has, the numbers measured on this machine
   * stand in, close enough to open the first window sanely and corrected the moment it renders.
   */
  let cellSize = null;
  const CHROME_W = 24;      // the window's own padding and border, either side
  const CHROME_H = 96;      // title bar, the cli-hints line and the padding around them

  /** What a character costs at the current face and size. Called again whenever the text size changes. */
  function measureCell(term) {
    try {
      const cell = term._core._renderService.dimensions.css.cell;
      if (cell && cell.width > 0) cellSize = { w: cell.width, h: cell.height };
    } catch (_) { /* the fallback in fitsSize stands */ }
  }

  /** The window's own chrome gets the palette as custom properties; terminals.css only reads them. */
  function paintChrome(win, name) {
    const s = styleOf(name);
    win.dataset.termStyle = name;
    win.style.setProperty('--term-bg', s.bg);
    win.style.setProperty('--term-fg', s.fg);
    win.style.setProperty('--term-bar', s.bar);
    win.style.setProperty('--term-bar-ink', s.barInk);
    const size = lookNow().size;
    win.querySelectorAll('[data-term-style]').forEach((b) => {
      const on = b.dataset.termStyle === name;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
      const sw = b.querySelector('.term-swatch');
      if (sw) {
        const o = styleOf(b.dataset.termStyle);
        sw.style.setProperty('--sw-bg', o.bg);
        sw.style.setProperty('--sw-fg', o.fg);
        sw.style.setProperty('--sw-ink', o.ansi[2]);
      }
    });
    win.querySelectorAll('.term-font-size').forEach((n) => { n.textContent = `${size} px`; });
  }

  /** Apply the stored look to every open window: a style is a preference, not a property of one terminal. */
  function paintLook() {
    const now = lookNow();
    windows().forEach((win) => {
      paintChrome(win, now.style);
      if (win.__term) win.__term.look();
    });
  }

  function storeLook(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* private window */ }
  }

  /** One step of text size: +1, -1, or 0 for the default. */
  function stepFont(by) {
    const now = lookNow().size;
    const next = by === 0 ? FONT_DEFAULT : Math.min(FONT_MAX, Math.max(FONT_MIN, now + by));
    if (next === now) return;
    storeLook(FONT_KEY, next);
    paintLook();
  }

  function sizeFor(cols, rows) {
    const cell = cellSize || { w: 7.83, h: 15 };
    return { w: Math.ceil(cols * cell.w) + CHROME_W, h: Math.ceil(rows * cell.h) + CHROME_H };
  }

  /**
   * What a window opens at: 132x43, the largest of the four.
   *
   * Not "the biggest that fits", which is what this did first — stepping down to 80x43 on a 1100px
   * display was tidy and wrong: the window is DRAGGABLE and RESIZABLE, so a few pixels of it past the
   * edge is a thing you move, while a terminal that opened too small is a thing you have to notice and
   * correct. `place` clamps whatever it is given to the viewport, so a display that genuinely cannot
   * hold 132x43 gets as much of it as it has room for rather than a smaller preset.
   */
  const DEFAULT_PRESET = { cols: 132, rows: 43 };
  function defaultPreset() { return DEFAULT_PRESET; }

  function fitsSize() {
    const p = defaultPreset();
    return sizeFor(p.cols, p.rows);
  }

  /**
   * Tidy every open window at once.
   *
   * List is one column down the screen, each full width — what one terminal and any long TUI want.
   * Grid tiles them, as many across as fit at a usable width: 80 columns is what every TUI assumes, so
   * the number across is decided by the room there is rather than by a number somebody picked.
   */
  function arrange(how) {
    const wins = windows();
    if (!wins.length) return;
    const pad = 12;
    const top = 64;
    const areaW = window.innerWidth - pad * 2;
    const areaH = window.innerHeight - top - pad;
    if (how === 'grid') {
      const across = Math.max(1, Math.min(wins.length, Math.floor(areaW / 560)));
      const down = Math.ceil(wins.length / across);
      const w = Math.floor((areaW - (across - 1) * pad) / across);
      const h = Math.max(MIN_H, Math.floor((areaH - (down - 1) * pad) / down));
      wins.forEach((win, i) => place(win, pad + (i % across) * (w + pad), top + Math.floor(i / across) * (h + pad), w, h));
    } else {
      const h = Math.max(MIN_H, Math.floor((areaH - (wins.length - 1) * pad) / wins.length));
      wins.forEach((win, i) => place(win, pad, top + i * (h + pad), areaW, h));
    }
    wins.forEach(remember);
    paint();
  }

  function setLayout(how) {
    writeJson(LAYOUT_KEY, how);
    try { localStorage.setItem(LAYOUT_KEY, how); } catch (_) { /* private window */ }
    arrange(how);
  }

  /**
   * The bar that says how many terminals are open and arranges them.
   *
   * It is rendered by the server, in the top bar beside Screens, and it is EMPTY and hidden until
   * there is something to say — the count is not the server's to know, since a window exists only in
   * the browser that opened it. This fills it and unhides it; with nothing open it goes away again,
   * so the top bar carries no control for a thing that is not there.
   *
   * A page that does not draw the top bar (the session's own tab at /terminal/<name>) simply has no
   * bar, and nothing here minds: there is one terminal there and nothing to arrange.
   */
  function paint() {
    const bar = document.getElementById('term-bar');
    if (!bar) return;
    const n = windows().length;
    bar.hidden = !n;
    if (!n) return;
    const count = bar.querySelector('.term-count');
    if (count) count.textContent = n === 1 ? '1 terminal' : `${n} terminals`;
    const how = layoutNow();
    bar.querySelectorAll('[data-term-layout]').forEach((b) => {
      const on = b.dataset.termLayout === how;
      b.classList.toggle('uk-button-primary', on);
      b.classList.toggle('uk-button-default', !on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  /* ---------------------------------------------------------------- opening */

  /**
   * Open a session as its own window, leaving every other one exactly as it is.
   *
   * Asking for one that is already open raises and flashes it instead of opening a second: two
   * windows on one screen session are two `screen -x` clients painting the same thing, which looks
   * like a bug and costs a PTY.
   */
  function openTerminal(session) {
    if (!window.htmx) return;
    const already = document.querySelector(`.term-window[data-session="${CSS.escape(session)}"]`);
    if (already) {
      raise(already);
      if (already.__term && already.__term.focus) already.__term.focus();
      already.classList.add('is-flash');
      setTimeout(() => already.classList.remove('is-flash'), 600);
      return;
    }
    const n = windows().length;
    layer();                       // the target has to exist before htmx is pointed at it
    window.htmx.ajax('GET', `/fragments/screen-term/${encodeURIComponent(session)}`,
      { target: '#term-windows', swap: 'beforeend' })
      .then(() => {
        const win = document.querySelector(`.term-window[data-session="${CSS.escape(session)}"]`);
        if (!win) return;
        const saved = readJson(GEOM_KEY, {})[session];
        const remembered = saved && Number.isFinite(saved.w);
        // Marked, so the 80-column correction below leaves a size somebody chose alone. A window they
        // deliberately made narrow is their decision; one that merely opened narrow is this file's.
        if (remembered) win.dataset.geom = '1';
        const g = remembered ? saved : cascade(n);
        place(win, g.x, g.y, g.w, g.h);
        raise(win);
        paint();
        mountVisible();
        // Mounted a moment later, so the keyboard goes to it once it exists.
        setTimeout(() => { if (win.__term && win.__term.focus) win.__term.focus(); }, 150);
      });
  }

  window.openTerminal = openTerminal;

  /* -------------------------------------------------------- drag and resize */

  // The title bar is the handle, minus its buttons: a drag that started on the close button would
  // close the window on release.
  document.addEventListener('pointerdown', (e) => {
    const win = e.target.closest('.term-window');
    if (!win) return;
    raise(win);
    const head = e.target.closest('.term-window-head');
    const grip = e.target.closest('.term-resize');
    if (!head && !grip) return;
    if (head && e.target.closest('button, a, input, select')) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    const start = { x: r.left, y: r.top, w: r.width, h: r.height };
    const target = head || grip;
    target.setPointerCapture(e.pointerId);
    win.classList.add('is-dragging');

    const move = (ev) => {
      const dx = ev.clientX - from.x;
      const dy = ev.clientY - from.y;
      if (grip) place(win, start.x, start.y, start.w + dx, start.h + dy);
      else place(win, start.x + dx, start.y + dy, start.w, start.h);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      win.classList.remove('is-dragging');
      remember(win);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  });

  // A display that got smaller must not leave a window off it.
  window.addEventListener('resize', () => {
    windows().forEach((win) => { const g = geomOf(win); place(win, g.x, g.y, g.w, g.h); });
  });

  /* ---------------------------------------------------------------- wiring */

  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open-terminal]');
    if (open) {
      e.preventDefault();
      const name = open.dataset.openTerminal;
      // Picked from the Screens list (or a workitem): that list is a modal, and a modal holds the keyboard,
      // so a terminal opened under it could be looked at and not typed into. It closes first.
      const modal = document.getElementById('editor-modal');
      if (modal && modal.contains(open) && window.UIkit) {
        const go = () => openTerminal(name);
        try {
          const done = window.UIkit.modal(modal).hide();
          if (done && done.then) done.then(go, go); else go();
        } catch (_) { go(); }
        return;
      }
      openTerminal(name);
      return;
    }
    const fontPick = e.target.closest('.term-look-menu [data-term-font]');
    if (fontPick) {
      e.preventDefault();
      const how = fontPick.dataset.termFont;
      stepFont(how === 'up' ? 1 : how === 'down' ? -1 : 0);
      return;
    }
    // Scoped to the menu: paintLook puts data-term-style on the window itself, so a bare selector matched
    // every click inside a window and cancelled it (a details summary would never open).
    const stylePick = e.target.closest('.term-look-menu [data-term-style]');
    if (stylePick) {
      e.preventDefault();
      if (STYLE_ORDER.includes(stylePick.dataset.termStyle)) {
        storeLook(STYLE_KEY, stylePick.dataset.termStyle);
        paintLook();
      }
      return;
    }
    const layout = e.target.closest('[data-term-layout]');
    if (layout) { e.preventDefault(); setLayout(layout.dataset.termLayout); return; }
    // A size chosen from the list, in columns and rows.
    const sizePick = e.target.closest('[data-term-size]');
    if (sizePick) {
      e.preventDefault();
      const win = sizePick.closest('.term-window');
      const asked = sizePick.dataset.termSize;
      const m = asked.match(/^(\d+)x(\d+)$/);
      const want = m ? sizeFor(Number(m[1]), Number(m[2])) : fitsSize();
      const r = win.getBoundingClientRect();
      place(win, r.left, r.top, want.w, want.h);
      // A size picked from the list IS a chosen size, so it is remembered and the 80-column correction
      // leaves it alone. "Biggest that fits" is the exception: it is the default, so it forgets.
      if (m) { remember(win); } else {
        const all = readJson(GEOM_KEY, {});
        delete all[win.dataset.session];
        writeJson(GEOM_KEY, all);
        delete win.dataset.geom;
      }
      if (window.UIkit) { const d = sizePick.closest('.uk-dropdown'); if (d) window.UIkit.dropdown(d).hide(false); }
      return;
    }
    const back = e.target.closest('.term-scrollback');
    if (back) {
      e.preventDefault();
      const win = back.closest('.term-window');
      if (win && win.__scrollBack) win.__scrollBack();
      return;
    }
    const close = e.target.closest('.term-close');
    if (close) { e.preventDefault(); closeWindow(close.closest('.term-window')); return; }
    const full = e.target.closest('.term-fullscreen');
    if (full) {
      e.preventDefault();
      const win = full.closest('.term-window');
      if (document.fullscreenElement) document.exitFullscreen();
      else if (win.requestFullscreen) win.requestFullscreen().then(() => win.__term && win.__term.refit()).catch(() => {});
    }
  });

  document.addEventListener('confirmed-remove', (e) => {
    const btn = e.target && e.target.closest ? e.target : null;
    if (!btn) return;
    // Close every terminal at once — through the confirm dialog, because several windows going at one
    // click is worth being asked about even though none of the sessions ends.
    if (btn.closest('.term-close-all')) { windows().forEach(closeWindow); return; }
    // Ctrl-C, down this window's own socket. The action endpoint cannot reach a session on the host
    // (the runner does not proxy screen's own keys), and this window is already attached to it.
    const interrupt = btn.closest('.term-interrupt');
    if (interrupt) {
      const win = interrupt.closest('.term-window');
      if (win && win.__term) win.__term.send(String.fromCharCode(3));
    }
  });

  // Double-click the title bar puts a window back to the size it opens at — 80 columns by 24 rows —
  // and FORGETS the remembered one, so it opens that way next time too. A window dragged small by
  // accident is otherwise small for good, and a stored geometry is the one thing a reload cannot undo.
  document.addEventListener('dblclick', (e) => {
    const head = e.target.closest('.term-window-head');
    if (!head || e.target.closest('button, a')) return;
    const win = head.closest('.term-window');
    const want = fitsSize();
    const r = win.getBoundingClientRect();
    place(win, r.left, r.top, want.w, want.h);
    const all = readJson(GEOM_KEY, {});
    delete all[win.dataset.session];
    writeJson(GEOM_KEY, all);
    delete win.dataset.geom;
  });

  document.addEventListener('fullscreenchange', () => {
    const full = !!document.fullscreenElement;
    windows().forEach((w) => {
      w.classList.toggle('is-full', full && w === document.fullscreenElement);
      if (w.__term) setTimeout(w.__term.refit, 120);
    });
  });

  // A killed session's pane is worth closing on its own: the verb answers into the page, and leaving a
  // dead terminal open invites typing into something that is not there any more.
  document.body.addEventListener('screen-killed', (e) => {
    const session = e.detail && e.detail.session;
    const win = session && document.querySelector(`.term-window[data-session="${CSS.escape(session)}"]`);
    if (win) closeWindow(win);
  });

  // The Dashboard style is read from the page's tokens, so it follows the light/dark switch.
  if (window.MutationObserver) {
    new MutationObserver(() => { if (lookNow().style === 'dashboard') paintLook(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  }

  document.addEventListener('DOMContentLoaded', () => { mountVisible(); paint(); });
  document.body.addEventListener('htmx:after:swap', () => { mountVisible(); paint(); });
  if (window.MutationObserver) {
    new MutationObserver((records) => {
      records.forEach((r) => r.removedNodes.forEach((n) => { if (n.nodeType === 1) reapDetached(n); }));
    }).observe(document.body, { childList: true, subtree: true });
  }
  mountVisible();
  paint();
})();
