// Built from src/browser by `npm run build:browser`: edit the .ts source there, not this file.
"use strict";
(function() {
  "use strict";
  const SPEED_KEY = "ws-media-speed";
  const MIN = 0.5;
  const MAX = 5;
  const STEP = 0.25;
  const store = {
    get() {
      try {
        return localStorage.getItem(SPEED_KEY);
      } catch (_) {
        return null;
      }
    },
    set(v) {
      try {
        localStorage.setItem(SPEED_KEY, String(v));
      } catch (_) {
      }
    }
  };
  const elementOf = (t) => t instanceof Element ? t : null;
  const closestOf = (t, selector) => {
    const el = elementOf(t);
    return el ? el.closest(selector) : null;
  };
  const savedSpeed = () => {
    const v = parseFloat(store.get() ?? "");
    return v >= MIN && v <= MAX ? v : 1;
  };
  const clock = (s) => {
    const n = Math.round(s);
    const h = Math.floor(n / 3600);
    const m = Math.floor(n % 3600 / 60);
    const pad = (x) => String(x).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(n % 60)}` : `${m}:${pad(n % 60)}`;
  };
  const cardOf = (el) => el ? el.closest(".media-card") : null;
  const mediaOf = (card) => card ? card.querySelector("video, audio") : null;
  function setSpeed(card, media, rate) {
    const r = Math.min(MAX, Math.max(MIN, Math.round(rate / STEP) * STEP));
    media.playbackRate = r;
    const label = card.querySelector("[data-speed-label]");
    if (label) label.textContent = `${r}×`;
    card.querySelectorAll("[data-sound-speed]").forEach((b) => {
      const on = parseFloat(b.dataset.soundSpeed ?? "") === r;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    store.set(r);
    return r;
  }
  document.addEventListener("click", (e) => {
    const b = closestOf(e.target, "[data-sound-speed]");
    const card = cardOf(b);
    const media = mediaOf(card);
    if (!b || !card || !media) return;
    setSpeed(card, media, parseFloat(b.dataset.soundSpeed ?? "") || 1);
    const drop = b.closest(".uk-dropdown");
    if (drop && window.UIkit) {
      try {
        window.UIkit.dropdown(drop).hide(false);
      } catch (_) {
      }
    }
  });
  document.addEventListener("change", (e) => {
    const box = e.target;
    if (!(box instanceof HTMLInputElement) || !box.matches("[data-sound-loop]")) return;
    const media = mediaOf(cardOf(box));
    if (media) media.loop = box.checked;
  });
  document.addEventListener("click", (e) => {
    const b = closestOf(e.target, "[data-seek]");
    const media = mediaOf(cardOf(b));
    if (!b || !media) return;
    media.currentTime = parseFloat(b.dataset.seek ?? "") || 0;
    media.play().catch(() => {
    });
  });
  let list = { els: [], index: -1 };
  document.addEventListener("click", (e) => {
    const t = closestOf(e.target, '[hx-get*="/play/"]');
    if (!t || !t.closest(".fx-file")) return;
    const els = [...document.querySelectorAll(".fx-file")].map((row) => row.querySelector('[hx-get*="/play/"]')).filter((x) => !!x);
    list = { els, index: els.findIndex((x) => x.closest(".fx-file") === t.closest(".fx-file")) };
  }, true);
  document.addEventListener("click", (e) => {
    const b = closestOf(e.target, "[data-media-step]");
    if (!b || b.disabled) return;
    const next = list.els[list.index + parseInt(b.dataset.mediaStep ?? "", 10)];
    if (next && document.contains(next)) next.click();
  });
  function setupChapters(card, media) {
    const bar = card.querySelector("[data-chapters]");
    const label = card.querySelector("[data-chapter]");
    if (!bar) return;
    let chapters = [];
    try {
      chapters = JSON.parse(bar.dataset.chapters ?? "");
    } catch (_) {
      return;
    }
    const last = chapters[chapters.length - 1];
    if (!last) return;
    const draw = () => {
      const total = media.duration || last.end;
      bar.innerHTML = "";
      chapters.forEach((c, i) => {
        const seg = document.createElement("button");
        seg.type = "button";
        seg.className = "chapter-seg";
        seg.dataset.seek = String(c.start);
        seg.title = `${c.title} · ${clock(c.start)}`;
        seg.style.flexGrow = String(Math.max(0.5, Math.min(c.end, total) - c.start));
        seg.dataset.index = String(i);
        bar.appendChild(seg);
      });
    };
    let current = -1;
    const track = () => {
      const t = media.currentTime;
      let i = chapters.findIndex((c) => t >= c.start && t < c.end);
      if (i < 0) i = t >= last.end ? chapters.length - 1 : 0;
      if (i === current) return;
      current = i;
      const chapter = chapters[i];
      if (!chapter) return;
      bar.querySelectorAll(".chapter-seg").forEach((s, k) => {
        s.classList.toggle("is-past", k < i);
        s.classList.toggle("is-current", k === i);
      });
      if (label) {
        label.hidden = false;
        label.textContent = chapter.title;
      }
      const sections = card.querySelectorAll(".transcript-section");
      sections.forEach((s) => s.classList.toggle("is-current", parseFloat(s.dataset.start ?? "") === chapter.start));
      const now = [...sections].find((s) => s.classList.contains("is-current"));
      const box = card.querySelector(".transcript-body");
      if (now && box && !media.paused) box.scrollTo({ top: now.offsetTop - box.offsetTop - 8, behavior: "smooth" });
    };
    draw();
    media.addEventListener("loadedmetadata", draw);
    media.addEventListener("timeupdate", track);
    media.addEventListener("seeked", track);
    track();
  }
  function setupCard(root) {
    const card = root.querySelector(".media-card:not([data-ready])");
    const media = mediaOf(card);
    if (!card || !media) return;
    card.dataset.ready = "1";
    setSpeed(card, media, savedSpeed());
    media.addEventListener("loadedmetadata", () => {
      media.playbackRate = savedSpeed();
      const slot = card.querySelector("[data-duration]");
      if (slot && media.duration) slot.textContent = ` · ${clock(media.duration)}`;
    });
    setupChapters(card, media);
    const at = list.index;
    card.querySelectorAll("[data-media-step]").forEach((b) => {
      const target = list.els[at + parseInt(b.dataset.mediaStep ?? "", 10)];
      b.disabled = !(at >= 0 && target && document.contains(target));
    });
    media.play().catch(() => {
    });
  }
  const onSwap = (e) => {
    const detail = e.detail;
    const el = detail && detail.target || elementOf(e.target);
    if (el && el.id === "editor-modal-body") setupCard(el);
  };
  document.body.addEventListener("htmx:after:swap", onSwap);
  document.body.addEventListener("htmx:after:settle", onSwap);
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const modal = document.getElementById("editor-modal");
    const card = modal && modal.classList.contains("uk-open") ? document.querySelector("#editor-modal-body .media-card") : null;
    const media = mediaOf(card);
    if (!card || !media) return;
    const t = elementOf(e.target);
    if (t && t.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
    if (t && t.closest("button, a, summary") && (e.key === " " || e.key === "Enter")) return;
    const seek = (by) => {
      media.currentTime = Math.max(0, Math.min(media.duration || Infinity, media.currentTime + by));
    };
    const key = e.key;
    let handled = true;
    if (key === " " || key === "k" || key === "K") {
      if (media.paused) media.play().catch(() => {
      });
      else media.pause();
    } else if (key === "j" || key === "J") seek(-10);
    else if (key === "l" || key === "L") seek(10);
    else if (key === "ArrowLeft") seek(-5);
    else if (key === "ArrowRight") seek(5);
    else if (key === "ArrowUp") media.volume = Math.min(1, media.volume + 0.1);
    else if (key === "ArrowDown") media.volume = Math.max(0, media.volume - 0.1);
    else if (key === "m" || key === "M") media.muted = !media.muted;
    else if ((key === "f" || key === "F") && media.tagName === "VIDEO") {
      if (document.fullscreenElement) document.exitFullscreen();
      else media.requestFullscreen().catch(() => {
      });
    } else if (key === "<" || key === ",") setSpeed(card, media, media.playbackRate - STEP);
    else if (key === ">" || key === ".") setSpeed(card, media, media.playbackRate + STEP);
    else if (/^[0-9]$/.test(key) && media.duration) media.currentTime = media.duration * parseInt(key, 10) / 10;
    else if (key === "Home") media.currentTime = 0;
    else if (key === "End" && media.duration) media.currentTime = media.duration - 0.1;
    else handled = false;
    if (handled) e.preventDefault();
  });
  let timer;
  let preview = null;
  const calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hovers = window.matchMedia && window.matchMedia("(hover: hover)").matches;
  function stopPreview() {
    clearTimeout(timer);
    if (preview) {
      try {
        preview.pause();
      } catch (_) {
      }
      preview.remove();
      preview = null;
    }
  }
  const related = (e) => e.relatedTarget instanceof Node ? e.relatedTarget : null;
  document.addEventListener("mouseover", (e) => {
    if (calm || !hovers) return;
    const thumb = closestOf(e.target, ".fx-thumb[data-preview]");
    if (!thumb || thumb.contains(related(e)) || getComputedStyle(thumb).display === "none") return;
    stopPreview();
    timer = setTimeout(() => {
      const v = document.createElement("video");
      v.className = "fx-preview";
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = thumb.dataset.preview ?? "";
      v.addEventListener("timeupdate", () => {
        if (v.currentTime > 6) v.currentTime = 0.2;
      });
      v.addEventListener("playing", () => thumb.classList.add("is-previewing"));
      thumb.insertBefore(v, thumb.firstChild);
      preview = v;
      v.play().catch(stopPreview);
    }, 450);
  });
  document.addEventListener("mouseout", (e) => {
    const thumb = closestOf(e.target, ".fx-thumb[data-preview]");
    if (thumb && !thumb.contains(related(e))) {
      thumb.classList.remove("is-previewing");
      stopPreview();
    }
  });
  document.addEventListener("click", stopPreview, true);
})();
