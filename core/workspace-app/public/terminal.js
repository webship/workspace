// Built from src/browser by `npm run build:browser`: edit the .ts source there, not this file.
"use strict";
(function terminals() {
  const XTERM = [
    ["Terminal", "/vendor/xterm/xterm.js"],
    ["FitAddon", "/vendor/xterm/addon-fit.js"],
    ["WebLinksAddon", "/vendor/xterm/addon-web-links.js"],
    ["Unicode11Addon", "/vendor/xterm/addon-unicode11.js"]
  ];
  function loadXterm() {
    if (window.__xtermLoading) return window.__xtermLoading;
    const need = XTERM.filter(([global]) => !window[global]).map(([, src]) => src);
    const fontsReady = () => document.fonts && document.fonts.load ? Promise.all(["400", "700"].map((w) => document.fonts.load(`${w} ${FONT_DEFAULT}px "Ubuntu Mono"`))).catch(() => {
    }) : Promise.resolve();
    if (!need.length) return fontsReady();
    window.__xtermLoading = Promise.all(need.map((src) => new Promise((ok, no) => {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        existing.addEventListener("load", ok);
        existing.addEventListener("error", no);
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.onload = ok;
      s.onerror = no;
      document.head.appendChild(s);
    }))).then(fontsReady).catch((err) => {
      window.__xtermLoading = null;
      throw err;
    });
    return window.__xtermLoading;
  }
  const cssVar = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const TERM_FONT = '"Ubuntu Mono", "Ubuntu Sans Mono", "DejaVu Sans Mono", "JetBrains Mono", ui-monospace, Menlo, monospace';
  const FONT_KEY = "ws-term-font";
  const STYLE_KEY = "ws-term-style";
  const FONT_MIN = 11;
  const FONT_MAX = 32;
  const FONT_DEFAULT = 17;
  const ANSI_KEYS = [
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite"
  ];
  const TANGO = [
    "#2e3436",
    "#cc0000",
    "#4e9a06",
    "#c4a000",
    "#3465a4",
    "#75507b",
    "#06989a",
    "#d3d7cf",
    "#555753",
    "#ef2929",
    "#8ae234",
    "#fce94f",
    "#729fcf",
    "#ad7fa8",
    "#34e2e2",
    "#eeeeec"
  ];
  const TERM_STYLES = {
    ubuntu: { bg: "#300a24", fg: "#ffffff", bar: "#2c001e", barInk: "#eeeeec", cursor: "#ffffff", select: "rgba(255,255,255,.28)", ansi: TANGO },
    tango: {
      bg: "#fdfdfb",
      fg: "#2e3436",
      bar: "#e8e6e3",
      barInk: "#2e3436",
      cursor: "#2e3436",
      select: "rgba(52,101,164,.28)",
      ansi: [
        "#2e3436",
        "#cc0000",
        "#3a7a04",
        "#9c7a00",
        "#3465a4",
        "#75507b",
        "#06808a",
        "#8a8f87",
        "#555753",
        "#d92020",
        "#4e9a06",
        "#b58b00",
        "#3a6fb5",
        "#8f5f96",
        "#0a8f95",
        "#2e3436"
      ]
    },
    solarized: {
      bg: "#002b36",
      fg: "#839496",
      bar: "#073642",
      barInk: "#93a1a1",
      cursor: "#93a1a1",
      select: "rgba(147,161,161,.28)",
      ansi: [
        "#073642",
        "#dc322f",
        "#859900",
        "#b58900",
        "#268bd2",
        "#d33682",
        "#2aa198",
        "#eee8d5",
        "#002b36",
        "#cb4b16",
        "#586e75",
        "#657b83",
        "#839496",
        "#6c71c4",
        "#93a1a1",
        "#fdf6e3"
      ]
    },
    dracula: {
      bg: "#282a36",
      fg: "#f8f8f2",
      bar: "#21222c",
      barInk: "#f8f8f2",
      cursor: "#f8f8f2",
      select: "rgba(98,114,164,.5)",
      ansi: [
        "#21222c",
        "#ff5555",
        "#50fa7b",
        "#f1fa8c",
        "#bd93f9",
        "#ff79c6",
        "#8be9fd",
        "#f8f8f2",
        "#6272a4",
        "#ff6e6e",
        "#69ff94",
        "#ffffa5",
        "#d6acff",
        "#ff92df",
        "#a4ffff",
        "#ffffff"
      ]
    }
  };
  const STYLE_ORDER = ["ubuntu", "tango", "solarized", "dracula", "dashboard"];
  function styleOf(name) {
    if (name === "dashboard") {
      const bg = cssVar("--code-bg", "#1f2437");
      return {
        bg,
        fg: cssVar("--code-ink", "#e6e9f5"),
        bar: cssVar("--surface", bg),
        barInk: cssVar("--text-default", "#e6e9f5"),
        cursor: cssVar("--terminal-ink", "#c9f7d4"),
        select: "rgba(255,255,255,.25)",
        ansi: TANGO
      };
    }
    return TERM_STYLES[name] || TERM_STYLES.ubuntu;
  }
  function lookNow() {
    let style = "ubuntu";
    let size = FONT_DEFAULT;
    try {
      const s = localStorage.getItem(STYLE_KEY);
      if (s && STYLE_ORDER.includes(s)) style = s;
      const n = parseInt(localStorage.getItem(FONT_KEY) || "", 10);
      if (n >= FONT_MIN && n <= FONT_MAX) size = n;
    } catch (_) {
    }
    return { style, size };
  }
  function xtermTheme(name) {
    const s = styleOf(name);
    const t = { background: s.bg, foreground: s.fg, cursor: s.cursor, cursorAccent: s.bg, selectionBackground: s.select };
    ANSI_KEYS.forEach((k, i) => {
      t[k] = s.ansi[i] ?? "";
    });
    return t;
  }
  function mount(pane) {
    if (pane.dataset.up) return;
    const session = pane.dataset.session;
    if (!session) return;
    pane.dataset.up = "1";
    const el = pane.querySelector(".term-screen");
    const status = pane.querySelector(".term-status");
    const again = pane.querySelector(".term-reconnect");
    const say = (text) => {
      if (status && status.textContent !== text) status.textContent = text;
    };
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
      fontWeightBold: "700",
      // xterm paints its own canvas, so it is told the palette of the chosen style, which the window's
      // own chrome gets too (paintLook).
      theme: xtermTheme(look.style)
    });
    paintChrome(pane, look.style);
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    const refit = () => {
      try {
        fit.fit();
      } catch (_) {
      }
      if (pane.__resized) pane.__resized();
    };
    try {
      if (window.Unicode11Addon) {
        term.loadAddon(new window.Unicode11Addon.Unicode11Addon());
        term.unicode.activeVersion = "11";
      }
    } catch (_) {
    }
    try {
      if (window.WebLinksAddon) {
        term.loadAddon(new window.WebLinksAddon.WebLinksAddon((event, uri) => {
          window.open(uri, "_blank", "noopener,noreferrer");
        }));
      }
    } catch (_) {
    }
    term.open(el);
    refit();
    measureCell(term);
    if (!pane.dataset.geom && term.cols < defaultPreset().cols) {
      const want = fitsSize();
      const r = pane.getBoundingClientRect();
      if (want.w > r.width && want.w <= window.innerWidth) place(pane, r.left, r.top, want.w, Math.max(r.height, want.h));
    }
    window.addEventListener("resize", refit);
    if (window.ResizeObserver) new ResizeObserver(refit).observe(pane);
    const HALF_UP = String.fromCharCode(21);
    const HALF_DOWN = String.fromCharCode(4);
    const enterCopyMode = () => {
      send(String.fromCharCode(1));
      send(String.fromCharCode(27));
    };
    pane.__scrollBack = enterCopyMode;
    el.addEventListener("wheel", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (e.ctrlKey) {
        stepFont(e.deltaY < 0 ? 1 : -1);
        return;
      }
      if (!pane.dataset.copyMode) {
        if (e.deltaY < 0) enterCopyMode();
        return;
      }
      send(e.deltaY < 0 ? HALF_UP : HALF_DOWN);
    }, { capture: true, passive: false });
    const proto = location.protocol === "https:" ? "wss://" : "ws://";
    let ws;
    let attachedAt = { cols: 0, rows: 0 };
    const KEEPALIVE_MS = 25e3;
    const ANSWER_MS = 1e4;
    const RETRY_MS = [1e3, 2e3, 4e3, 8e3, 15e3, 3e4];
    let pingTimer = null;
    let answerTimer = null;
    let retryTimer = null;
    let retries = 0;
    let reattachedAt = 0;
    const liveText = () => Date.now() - reattachedAt < 15e3 ? "re-attached after the connection dropped" : "connected";
    const stopKeepalive = () => {
      clearInterval(pingTimer);
      clearTimeout(answerTimer);
    };
    const startKeepalive = (sock) => {
      stopKeepalive();
      let answers = 0;
      sock.__answered = () => {
        answers += 1;
        clearTimeout(answerTimer);
      };
      pingTimer = setInterval(() => {
        if (sock !== ws || sock.readyState !== 1) return;
        try {
          sock.send(new Uint8Array(0));
        } catch (_) {
          return;
        }
        clearTimeout(answerTimer);
        if (!answers) return;
        answerTimer = setTimeout(() => {
          if (sock !== ws) return;
          sock.onclose = null;
          sock.onmessage = null;
          try {
            sock.close();
          } catch (_) {
          }
          dropped();
        }, ANSWER_MS);
      }, KEEPALIVE_MS);
    };
    const wire = () => {
      attachedAt = { cols: term.cols, rows: term.rows };
      clearTimeout(retryTimer);
      retryTimer = null;
      ws = new WebSocket(`${proto}${location.host}/ws/screen/${encodeURIComponent(session)}?cols=${term.cols}&rows=${term.rows}`);
      ws.binaryType = "arraybuffer";
      ws.onmessage = (e) => {
        if (typeof e.data !== "string" && e.data.byteLength === 0) {
          const sock = e.target;
          if (sock.__answered) sock.__answered();
          return;
        }
        const data = typeof e.data === "string" ? e.data : new Uint8Array(e.data);
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        if (/Copy mode aborted/.test(text)) {
          delete pane.dataset.copyMode;
          say(pane.dataset.live ? liveText() : "detached");
        } else if (/Copy mode/.test(text)) {
          pane.dataset.copyMode = "1";
          say("scrollback — the wheel moves, q leaves it");
        }
        if (text.length) {
          pane.dataset.painted = "1";
          retries = 0;
          if (pane.dataset.dropped) {
            reattachedAt = Date.now();
            delete pane.dataset.dropped;
            pane.dataset.link = "reattached";
            clearTimeout(pane.__linkNews);
            pane.__linkNews = setTimeout(() => {
              delete pane.dataset.link;
              if (pane.dataset.live && !pane.dataset.copyMode) say("connected");
            }, 15e3);
          }
          clearTimeout(pane.__silence);
          if (pane.dataset.live && !pane.dataset.copyMode) say(liveText());
        }
        term.write(data);
      };
      ws.onopen = () => {
        if (!pane.dataset.dropped) {
          clearTimeout(pane.__linkNews);
          delete pane.dataset.link;
        }
        say(pane.dataset.dropped ? "connection dropped — re-attaching…" : liveText());
        pane.dataset.live = "1";
        if (again) again.hidden = true;
        startKeepalive(ws);
        clearTimeout(pane.__silence);
        pane.__silence = setTimeout(() => {
          if (pane.dataset.painted || !pane.dataset.live) return;
          say("attached — nothing painted yet, press a key or use ↻");
          if (again) again.hidden = false;
        }, 6e3);
      };
      ws.onclose = dropped;
    };
    function dropped(evt) {
      const onPurpose = !!(evt && evt.wasClean);
      stopKeepalive();
      delete pane.dataset.live;
      delete pane.dataset.painted;
      clearTimeout(pane.__silence);
      if (!pane.isConnected) return;
      if (again) again.hidden = false;
      clearTimeout(pane.__linkNews);
      pane.dataset.link = "dropped";
      say("disconnected — checking…");
      const retry = (why) => {
        if (!pane.isConnected) return;
        if (retries >= RETRY_MS.length) {
          say(`detached — ${why}; ↻ attaches it again`);
          return;
        }
        const wait = RETRY_MS[retries];
        retries += 1;
        pane.dataset.dropped = "1";
        say(`connection dropped — re-attaching in ${Math.round(wait / 1e3)} s…`);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = null;
          if (!pane.isConnected) return;
          say("connection dropped — re-attaching…");
          wire();
        }, wait);
      };
      const ended = () => {
        say("the session ended");
        if (again) again.hidden = true;
        pane.dataset.ended = "1";
        pane.dataset.link = "ended";
      };
      const isAlive = () => fetch(`/fragments/screen-alive/${encodeURIComponent(session)}`).then((r) => r.text()).then((alive) => alive.trim() === "1");
      isAlive().then((live) => {
        if (!live) return ended();
        if (!onPurpose) return retry("the session keeps running, the connection keeps dropping");
        return new Promise((r) => {
          setTimeout(r, 2500);
        }).then(isAlive).then((still) => still ? say("detached — the session keeps running") : ended());
      }).catch(() => onPurpose ? say("detached") : retry("the dashboard does not answer"));
    }
    const retryNow = () => {
      if (!retryTimer || pane.dataset.live) return;
      clearTimeout(retryTimer);
      retryTimer = null;
      say("connection dropped — re-attaching…");
      wire();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retryNow();
    };
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", onVisible);
    wire();
    let resizeTimer = null;
    const resized = () => {
      if (term.cols === attachedAt.cols && term.rows === attachedAt.rows) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (term.cols === attachedAt.cols && term.rows === attachedAt.rows) return;
        say(`resizing to ${term.cols}×${term.rows}…`);
        try {
          ws.send(String.fromCharCode(1));
          ws.send("d");
        } catch (_) {
        }
        try {
          ws.onclose = null;
          ws.close();
        } catch (_) {
        }
        wire();
      }, 400);
    };
    pane.__resized = resized;
    const ESC = String.fromCharCode(27);
    const isMouseReport = (s) => s.charAt(0) === ESC && s.charAt(1) === "[" && (s.charAt(2) === "<" || s.charAt(2) === "M");
    const send = (d) => {
      if (!isMouseReport(d) && ws.readyState === 1) ws.send(d);
    };
    term.onData(send);
    term.onBinary(send);
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey || e.altKey || e.metaKey) return true;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        stepFont(1);
        return false;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        stepFont(-1);
        return false;
      }
      if (e.key === "0") {
        e.preventDefault();
        stepFont(0);
        return false;
      }
      return true;
    });
    const focus = () => {
      try {
        term.focus();
      } catch (_) {
      }
    };
    pane.addEventListener("mousedown", focus);
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
        clearTimeout(retryTimer);
        clearTimeout(pane.__linkNews);
        stopKeepalive();
        window.removeEventListener("online", retryNow);
        document.removeEventListener("visibilitychange", onVisible);
        try {
          ws.onclose = null;
          ws.close();
        } catch (_) {
        }
        try {
          term.dispose();
        } catch (_) {
        }
        window.removeEventListener("resize", refit);
      }
    };
  }
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  function mountVisible() {
    const pending = [...document.querySelectorAll(".term-window:not([data-up])")].filter(onScreen);
    if (!pending.length) return;
    loadXterm().then(() => pending.forEach(mount)).catch(() => {
    });
  }
  function closeWindow(win) {
    if (win.__term) win.__term.close();
    win.remove();
    paint();
  }
  function reapDetached(root) {
    (root.querySelectorAll ? [...root.querySelectorAll(".term-window")] : []).concat(root.classList && root.classList.contains("term-window") ? [root] : []).forEach((win) => {
      if (win.__term) win.__term.close();
    });
  }
  const LAYOUT_KEY = "ws-term-layout";
  const GEOM_KEY = "ws-term-windows";
  const MIN_W = 420;
  const MIN_H = 220;
  let topZ = 40;
  const readJson = (key, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") || fallback;
    } catch (_) {
      return fallback;
    }
  };
  const writeJson = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
    }
  };
  const layoutNow = () => localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "list";
  function layer() {
    let el = document.getElementById("term-windows");
    if (!el) {
      el = document.createElement("div");
      el.id = "term-windows";
      document.body.appendChild(el);
    }
    return el;
  }
  const windows = () => [...document.querySelectorAll(".term-window")];
  function place(win, x, y, w, h) {
    const width = Math.max(MIN_W, Math.round(w || win.offsetWidth || 720));
    const height = Math.max(MIN_H, Math.round(h || win.offsetHeight || 420));
    const maxX = Math.max(0, window.innerWidth - Math.min(width, 120));
    const maxY = Math.max(0, window.innerHeight - 44);
    const top = Math.min(Math.max(0, Math.round(y)), maxY);
    win.style.width = `${Math.min(width, window.innerWidth)}px`;
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
    win.dataset.geom = "1";
    const all = readJson(GEOM_KEY, {});
    all[win.dataset.session] = geomOf(win);
    writeJson(GEOM_KEY, all);
  }
  function raise(win) {
    topZ += 1;
    win.style.zIndex = String(topZ);
    windows().forEach((w) => w.classList.toggle("is-front", w === win));
  }
  function cascade(n) {
    const want = fitsSize();
    const w = Math.min(Math.max(want.w, Math.round(window.innerWidth * 0.52)), Math.round(window.innerWidth * 0.94));
    const h = Math.min(Math.max(want.h, Math.round(window.innerHeight * 0.55)), Math.round(window.innerHeight * 0.9));
    const step = 28;
    return { x: 40 + n % 6 * step, y: 70 + n % 6 * step, w, h };
  }
  const PRESETS = [
    { cols: 80, rows: 24 },
    { cols: 80, rows: 43 },
    { cols: 132, rows: 24 },
    { cols: 132, rows: 43 }
  ];
  let cellSize = null;
  const CHROME_W = 24;
  const CHROME_H = 96;
  function measureCell(term) {
    try {
      const cell = term._core._renderService.dimensions.css.cell;
      if (cell && cell.width > 0) cellSize = { w: cell.width, h: cell.height };
    } catch (_) {
    }
  }
  function paintChrome(win, name) {
    const s = styleOf(name);
    win.dataset.termStyle = name;
    win.style.setProperty("--term-bg", s.bg);
    win.style.setProperty("--term-fg", s.fg);
    win.style.setProperty("--term-bar", s.bar);
    win.style.setProperty("--term-bar-ink", s.barInk);
    const size = lookNow().size;
    win.querySelectorAll("[data-term-style]").forEach((b) => {
      const on = b.dataset.termStyle === name;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-checked", String(on));
      const sw = b.querySelector(".term-swatch");
      if (sw) {
        const o = styleOf(b.dataset.termStyle);
        sw.style.setProperty("--sw-bg", o.bg);
        sw.style.setProperty("--sw-fg", o.fg);
        sw.style.setProperty("--sw-ink", o.ansi[2]);
      }
    });
    win.querySelectorAll(".term-font-size").forEach((n) => {
      n.textContent = `${size} px`;
    });
  }
  function paintLook() {
    const now = lookNow();
    windows().forEach((win) => {
      paintChrome(win, now.style);
      if (win.__term) win.__term.look();
    });
  }
  function storeLook(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {
    }
  }
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
  const DEFAULT_PRESET = { cols: 132, rows: 43 };
  function defaultPreset() {
    return DEFAULT_PRESET;
  }
  function fitsSize() {
    const p = defaultPreset();
    return sizeFor(p.cols, p.rows);
  }
  function arrange(how) {
    const wins = windows();
    if (!wins.length) return;
    const pad = 12;
    const top = 64;
    const areaW = window.innerWidth - pad * 2;
    const areaH = window.innerHeight - top - pad;
    if (how === "grid") {
      const across = Math.max(1, Math.min(wins.length, Math.floor(areaW / 560)));
      const down = Math.ceil(wins.length / across);
      const w = Math.floor((areaW - (across - 1) * pad) / across);
      const h = Math.max(MIN_H, Math.floor((areaH - (down - 1) * pad) / down));
      wins.forEach((win, i) => place(win, pad + i % across * (w + pad), top + Math.floor(i / across) * (h + pad), w, h));
    } else {
      const h = Math.max(MIN_H, Math.floor((areaH - (wins.length - 1) * pad) / wins.length));
      wins.forEach((win, i) => place(win, pad, top + i * (h + pad), areaW, h));
    }
    wins.forEach(remember);
    paint();
  }
  function setLayout(how) {
    writeJson(LAYOUT_KEY, how);
    try {
      localStorage.setItem(LAYOUT_KEY, how);
    } catch (_) {
    }
    arrange(how);
  }
  function paint() {
    const bar = document.getElementById("term-bar");
    if (!bar) return;
    const n = windows().length;
    bar.hidden = !n;
    if (!n) return;
    const count = bar.querySelector(".term-count");
    if (count) count.textContent = n === 1 ? "1 terminal" : `${n} terminals`;
    const how = layoutNow();
    bar.querySelectorAll("[data-term-layout]").forEach((b) => {
      const on = b.dataset.termLayout === how;
      b.classList.toggle("uk-button-primary", on);
      b.classList.toggle("uk-button-default", !on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function openTerminal(session) {
    if (!window.htmx) return;
    const already = document.querySelector(`.term-window[data-session="${CSS.escape(session)}"]`);
    if (already) {
      raise(already);
      if (already.__term && already.__term.focus) already.__term.focus();
      already.classList.add("is-flash");
      setTimeout(() => already.classList.remove("is-flash"), 600);
      return;
    }
    const n = windows().length;
    layer();
    window.htmx.ajax(
      "GET",
      `/fragments/screen-term/${encodeURIComponent(session)}`,
      { target: "#term-windows", swap: "beforeend" }
    ).then(() => {
      const win = document.querySelector(`.term-window[data-session="${CSS.escape(session)}"]`);
      if (!win) return;
      const saved = readJson(GEOM_KEY, {})[session];
      const remembered = saved && Number.isFinite(saved.w);
      if (remembered) win.dataset.geom = "1";
      const g = remembered ? saved : cascade(n);
      place(win, g.x, g.y, g.w, g.h);
      raise(win);
      paint();
      mountVisible();
      setTimeout(() => {
        if (win.__term && win.__term.focus) win.__term.focus();
      }, 150);
    });
  }
  window.openTerminal = openTerminal;
  document.addEventListener("pointerdown", (e) => {
    const win = e.target.closest(".term-window");
    if (!win) return;
    raise(win);
    const head = e.target.closest(".term-window-head");
    const grip = e.target.closest(".term-resize");
    if (!head && !grip) return;
    if (head && e.target.closest("button, a, input, select")) return;
    e.preventDefault();
    const r = win.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    const start = { x: r.left, y: r.top, w: r.width, h: r.height };
    const target = head || grip;
    target.setPointerCapture(e.pointerId);
    win.classList.add("is-dragging");
    const move = (ev) => {
      const dx = ev.clientX - from.x;
      const dy = ev.clientY - from.y;
      if (grip) place(win, start.x, start.y, start.w + dx, start.h + dy);
      else place(win, start.x + dx, start.y + dy, start.w, start.h);
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      win.classList.remove("is-dragging");
      remember(win);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  });
  window.addEventListener("resize", () => {
    windows().forEach((win) => {
      const g = geomOf(win);
      place(win, g.x, g.y, g.w, g.h);
    });
  });
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open-terminal]");
    if (open) {
      e.preventDefault();
      const name = open.dataset.openTerminal;
      const modal = document.getElementById("editor-modal");
      if (modal && modal.contains(open) && window.UIkit) {
        const go = () => openTerminal(name);
        try {
          const done = window.UIkit.modal(modal).hide();
          if (done && done.then) done.then(go, go);
          else go();
        } catch (_) {
          go();
        }
        return;
      }
      openTerminal(name);
      return;
    }
    const fontPick = e.target.closest(".term-look-menu [data-term-font]");
    if (fontPick) {
      e.preventDefault();
      const how = fontPick.dataset.termFont;
      stepFont(how === "up" ? 1 : how === "down" ? -1 : 0);
      return;
    }
    const stylePick = e.target.closest(".term-look-menu [data-term-style]");
    if (stylePick) {
      e.preventDefault();
      if (STYLE_ORDER.includes(stylePick.dataset.termStyle)) {
        storeLook(STYLE_KEY, stylePick.dataset.termStyle);
        paintLook();
      }
      return;
    }
    const layout = e.target.closest("[data-term-layout]");
    if (layout) {
      e.preventDefault();
      setLayout(layout.dataset.termLayout);
      return;
    }
    const sizePick = e.target.closest("[data-term-size]");
    if (sizePick) {
      e.preventDefault();
      const win = sizePick.closest(".term-window");
      const asked = sizePick.dataset.termSize;
      const m = asked.match(/^(\d+)x(\d+)$/);
      const want = m ? sizeFor(Number(m[1]), Number(m[2])) : fitsSize();
      const r = win.getBoundingClientRect();
      place(win, r.left, r.top, want.w, want.h);
      if (m) {
        remember(win);
      } else {
        const all = readJson(GEOM_KEY, {});
        delete all[win.dataset.session];
        writeJson(GEOM_KEY, all);
        delete win.dataset.geom;
      }
      if (window.UIkit) {
        const d = sizePick.closest(".uk-dropdown");
        if (d) window.UIkit.dropdown(d).hide(false);
      }
      return;
    }
    const back = e.target.closest(".term-scrollback");
    if (back) {
      e.preventDefault();
      const win = back.closest(".term-window");
      if (win && win.__scrollBack) win.__scrollBack();
      return;
    }
    const close = e.target.closest(".term-close");
    if (close) {
      e.preventDefault();
      closeWindow(close.closest(".term-window"));
      return;
    }
    const full = e.target.closest(".term-fullscreen");
    if (full) {
      e.preventDefault();
      const win = full.closest(".term-window");
      if (document.fullscreenElement) document.exitFullscreen();
      else if (win.requestFullscreen) win.requestFullscreen().then(() => win.__term && win.__term.refit()).catch(() => {
      });
    }
  });
  document.addEventListener("confirmed-remove", (e) => {
    const btn = e.target && e.target.closest ? e.target : null;
    if (!btn) return;
    if (btn.closest(".term-close-all")) {
      windows().forEach(closeWindow);
      return;
    }
    const interrupt = btn.closest(".term-interrupt");
    if (interrupt) {
      const win = interrupt.closest(".term-window");
      if (win && win.__term) win.__term.send(String.fromCharCode(3));
    }
  });
  document.addEventListener("dblclick", (e) => {
    const head = e.target.closest(".term-window-head");
    if (!head || e.target.closest("button, a")) return;
    const win = head.closest(".term-window");
    const want = fitsSize();
    const r = win.getBoundingClientRect();
    place(win, r.left, r.top, want.w, want.h);
    const all = readJson(GEOM_KEY, {});
    delete all[win.dataset.session];
    writeJson(GEOM_KEY, all);
    delete win.dataset.geom;
  });
  document.addEventListener("fullscreenchange", () => {
    const full = !!document.fullscreenElement;
    windows().forEach((w) => {
      w.classList.toggle("is-full", full && w === document.fullscreenElement);
      if (w.__term) setTimeout(w.__term.refit, 120);
    });
  });
  document.body.addEventListener("screen-killed", (e) => {
    const session = e.detail?.session;
    const win = session && document.querySelector(`.term-window[data-session="${CSS.escape(session)}"]`);
    if (win) closeWindow(win);
  });
  if (window.MutationObserver) {
    new MutationObserver(() => {
      if (lookNow().style === "dashboard") paintLook();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  }
  document.addEventListener("DOMContentLoaded", () => {
    mountVisible();
    paint();
  });
  document.body.addEventListener("htmx:after:swap", () => {
    mountVisible();
    paint();
  });
  if (window.MutationObserver) {
    new MutationObserver((records) => {
      records.forEach((r) => r.removedNodes.forEach((n) => {
        if (n.nodeType === 1) reapDetached(n);
      }));
    }).observe(document.body, { childList: true, subtree: true });
  }
  mountVisible();
  paint();
})();
