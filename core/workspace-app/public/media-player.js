// The player in the editor modal, with the habits people bring from YouTube and Vimeo: it starts when
// opened, remembers the speed you chose, answers the keyboard, shows the chapter you are in, steps to the
// previous and next recording in the list, and a card shows a short silent preview while the pointer is on it.
(function () {
  'use strict';

  const SPEED_KEY = 'ws-media-speed';
  const MIN = 0.5;
  const MAX = 5;
  const STEP = 0.25;

  const store = {
    get() { try { return localStorage.getItem(SPEED_KEY); } catch (_) { return null; } },
    set(v) { try { localStorage.setItem(SPEED_KEY, String(v)); } catch (_) { /* private window */ } },
  };

  const savedSpeed = () => { const v = parseFloat(store.get()); return v >= MIN && v <= MAX ? v : 1; };
  const clock = (s) => {
    const n = Math.round(s); const h = Math.floor(n / 3600); const m = Math.floor((n % 3600) / 60);
    const pad = (x) => String(x).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(n % 60)}` : `${m}:${pad(n % 60)}`;
  };
  const cardOf = (el) => el.closest && el.closest('.media-card');
  const mediaOf = (card) => card && card.querySelector('video, audio');

  function setSpeed(card, media, rate) {
    const r = Math.min(MAX, Math.max(MIN, Math.round(rate / STEP) * STEP));
    media.playbackRate = r;
    const label = card.querySelector('[data-speed-label]');
    if (label) label.textContent = `${r}×`;
    card.querySelectorAll('[data-sound-speed]').forEach((b) => {
      const on = parseFloat(b.dataset.soundSpeed) === r;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    store.set(r);
    return r;
  }

  // ---- speed and loop -------------------------------------------------------------------------------
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-sound-speed]');
    const card = b && cardOf(b);
    const media = mediaOf(card);
    if (!media) return;
    setSpeed(card, media, parseFloat(b.dataset.soundSpeed) || 1);
    const drop = b.closest('.uk-dropdown');
    if (drop && window.UIkit) { try { window.UIkit.dropdown(drop).hide(false); } catch (_) { /* closed already */ } }
  });
  document.addEventListener('change', (e) => {
    if (!e.target.matches || !e.target.matches('[data-sound-loop]')) return;
    const media = mediaOf(cardOf(e.target));
    if (media) media.loop = e.target.checked;
  });

  // ---- a section time, or a chapter, seeks ---------------------------------------------------------
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-seek]');
    const media = mediaOf(b && cardOf(b));
    if (!media) return;
    media.currentTime = parseFloat(b.dataset.seek) || 0;
    media.play().catch(() => { /* a gesture was asked for first; the seek still happened */ });
  });

  // ---- previous and next, through the list the recording was opened from ---------------------------
  let list = { els: [], index: -1 };
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[hx-get*="/play/"]');
    if (!t || !t.closest('.fx-file')) return;
    const els = [...document.querySelectorAll('.fx-file')].map((row) => row.querySelector('[hx-get*="/play/"]')).filter(Boolean);
    list = { els, index: els.findIndex((x) => x.closest('.fx-file') === t.closest('.fx-file')) };
  }, true);
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-media-step]');
    if (!b || b.disabled) return;
    const next = list.els[list.index + parseInt(b.dataset.mediaStep, 10)];
    if (next && document.contains(next)) next.click();
  });

  // ---- the card behind the modal --------------------------------------------------------------------
  function setupChapters(card, media) {
    const bar = card.querySelector('[data-chapters]');
    const label = card.querySelector('[data-chapter]');
    if (!bar) return;
    let chapters = [];
    try { chapters = JSON.parse(bar.dataset.chapters); } catch (_) { return; }
    if (!chapters.length) return;
    const draw = () => {
      const total = media.duration || chapters[chapters.length - 1].end;
      bar.innerHTML = '';
      chapters.forEach((c, i) => {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'chapter-seg';
        seg.dataset.seek = c.start;
        seg.title = `${c.title} · ${clock(c.start)}`;
        seg.style.flexGrow = Math.max(0.5, Math.min(c.end, total) - c.start);
        seg.dataset.index = i;
        bar.appendChild(seg);
      });
    };
    let current = -1;
    const track = () => {
      const t = media.currentTime;
      let i = chapters.findIndex((c) => t >= c.start && t < c.end);
      if (i < 0) i = t >= chapters[chapters.length - 1].end ? chapters.length - 1 : 0;
      if (i === current) return;
      current = i;
      bar.querySelectorAll('.chapter-seg').forEach((s, k) => { s.classList.toggle('is-past', k < i); s.classList.toggle('is-current', k === i); });
      if (label) { label.hidden = false; label.textContent = chapters[i].title; }
      const sections = card.querySelectorAll('.transcript-section');
      sections.forEach((s) => s.classList.toggle('is-current', parseFloat(s.dataset.start) === chapters[i].start));
      const now = [...sections].find((s) => s.classList.contains('is-current'));
      const box = card.querySelector('.transcript-body');
      if (now && box && !media.paused) box.scrollTo({ top: now.offsetTop - box.offsetTop - 8, behavior: 'smooth' });
    };
    draw();
    media.addEventListener('loadedmetadata', draw);
    media.addEventListener('timeupdate', track);
    media.addEventListener('seeked', track);
    track();
  }

  function setupCard(root) {
    const card = root.querySelector && root.querySelector('.media-card:not([data-ready])');
    const media = mediaOf(card);
    if (!media) return;
    card.dataset.ready = '1';
    setSpeed(card, media, savedSpeed());
    media.addEventListener('loadedmetadata', () => {
      media.playbackRate = savedSpeed();
      const slot = card.querySelector('[data-duration]');
      if (slot && media.duration) slot.textContent = ` · ${clock(media.duration)}`;
    });
    setupChapters(card, media);
    const at = list.index;
    card.querySelectorAll('[data-media-step]').forEach((b) => {
      const target = list.els[at + parseInt(b.dataset.mediaStep, 10)];
      b.disabled = !(at >= 0 && target && document.contains(target));
    });
    media.play().catch(() => { /* autoplay refused; the play button is there */ });
  }
  const onSwap = (e) => {
    const el = (e.detail && e.detail.target) || e.target;
    if (el && el.id === 'editor-modal-body') setupCard(el);
  };
  document.body.addEventListener('htmx:after:swap', onSwap);
  document.body.addEventListener('htmx:after:settle', onSwap);

  // ---- the keyboard -----------------------------------------------------------------------------------
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const modal = document.getElementById('editor-modal');
    const card = modal && modal.classList.contains('uk-open') && document.querySelector('#editor-modal-body .media-card');
    const media = mediaOf(card);
    if (!media) return;
    const t = e.target;
    if (t.closest && t.closest('input:not([type="checkbox"]), textarea, select, [contenteditable="true"]')) return;
    if (t.closest && t.closest('button, a, summary') && (e.key === ' ' || e.key === 'Enter')) return;
    const seek = (by) => { media.currentTime = Math.max(0, Math.min(media.duration || Infinity, media.currentTime + by)); };
    const key = e.key;
    let handled = true;
    if (key === ' ' || key === 'k' || key === 'K') { if (media.paused) media.play().catch(() => {}); else media.pause(); }
    else if (key === 'j' || key === 'J') seek(-10);
    else if (key === 'l' || key === 'L') seek(10);
    else if (key === 'ArrowLeft') seek(-5);
    else if (key === 'ArrowRight') seek(5);
    else if (key === 'ArrowUp') media.volume = Math.min(1, media.volume + 0.1);
    else if (key === 'ArrowDown') media.volume = Math.max(0, media.volume - 0.1);
    else if (key === 'm' || key === 'M') media.muted = !media.muted;
    else if ((key === 'f' || key === 'F') && media.tagName === 'VIDEO') {
      if (document.fullscreenElement) document.exitFullscreen(); else media.requestFullscreen().catch(() => {});
    } else if (key === '<' || key === ',') setSpeed(card, media, media.playbackRate - STEP);
    else if (key === '>' || key === '.') setSpeed(card, media, media.playbackRate + STEP);
    else if (/^[0-9]$/.test(key) && media.duration) media.currentTime = (media.duration * parseInt(key, 10)) / 10;
    else if (key === 'Home') media.currentTime = 0;
    else if (key === 'End' && media.duration) media.currentTime = media.duration - 0.1;
    else handled = false;
    if (handled) e.preventDefault();
  });

  // ---- a card shows a short, silent preview while the pointer rests on it ----------------------------
  let timer = null;
  let preview = null;
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hovers = window.matchMedia && window.matchMedia('(hover: hover)').matches;
  function stopPreview() {
    clearTimeout(timer);
    if (preview) { try { preview.pause(); } catch (_) { /* gone */ } preview.remove(); preview = null; }
  }
  document.addEventListener('mouseover', (e) => {
    if (calm || !hovers) return;
    const thumb = e.target.closest && e.target.closest('.fx-thumb[data-preview]');
    if (!thumb || thumb.contains(e.relatedTarget) || getComputedStyle(thumb).display === 'none') return;
    stopPreview();
    timer = setTimeout(() => {
      const v = document.createElement('video');
      v.className = 'fx-preview';
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = thumb.dataset.preview;
      v.addEventListener('timeupdate', () => { if (v.currentTime > 6) v.currentTime = 0.2; });
      v.addEventListener('playing', () => thumb.classList.add('is-previewing'));
      thumb.insertBefore(v, thumb.firstChild);
      preview = v;
      v.play().catch(stopPreview);
    }, 450);
  });
  document.addEventListener('mouseout', (e) => {
    const thumb = e.target.closest && e.target.closest('.fx-thumb[data-preview]');
    if (thumb && !thumb.contains(e.relatedTarget)) { thumb.classList.remove('is-previewing'); stopPreview(); }
  });
  document.addEventListener('click', stopPreview, true);
})();
