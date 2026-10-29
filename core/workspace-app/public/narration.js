// Spoken summary of the assistant's answers. Loaded by the page and required by the unit tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.wsNarration = factory();
}(typeof self !== 'undefined' ? self : this, () => {
  const PREF = 'ws-voice';
  const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

  const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m]);

  // Speakable text: no markdown marks, and a URL becomes "a link".
  function cleanSpoken(text, max = 300) {
    let t = String(text || '')
      .replace(/https?:\/\/\S+/g, 'a link')
      .replace(/[`*_#>|~]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, '');
    return t;
  }

  // The first sentences of a rendered reply, leaving out code blocks, tables, buttons and the plan card.
  function summaryFromHtml(html, { maxChars = 240, maxSentences = 2 } = {}) {
    const text = String(html || '')
      .replace(/<div class="plan-card"[\s\S]*$/, ' ')
      .replace(/<(pre|table|button|script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|li|h[1-6]|div|tr)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>/g, '');
    const lines = decode(text).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
      .map((l) => (/[.!?:;]$/.test(l) ? l : `${l}.`));
    const sentences = cleanSpoken(lines.join(' '), 2000).split(/(?<=[.!?])\s+/).filter(Boolean);
    let out = '';
    for (const s of sentences.slice(0, maxSentences)) {
      if (out && out.length + s.length + 1 > maxChars) break;
      out = out ? `${out} ${s}` : s;
    }
    return cleanSpoken(out, maxChars);
  }

  // The best free voice this browser has, when none is configured: the neural ones first (Edge's
  // "Natural" and "Online" voices, Chrome's "Google" voices, Apple's "Enhanced" and "Premium"), in the
  // language asked for; the browser's default when it has nothing better.
  function bestVoice(voices, lang) {
    const want = String(lang || 'en').toLowerCase().slice(0, 2);
    const quality = (v) => (/natural|neural|online/i.test(v.name) ? 8 : 0) + (/google/i.test(v.name) ? 4 : 0)
      + (/enhanced|premium/i.test(v.name) ? 2 : 0);
    const score = (v) => quality(v) * 2 + (String(v.lang || '').toLowerCase() === String(lang || '').toLowerCase() ? 1 : 0);
    const fit = (voices || []).filter((v) => String(v.lang || '').toLowerCase().startsWith(want));
    const best = fit.sort((a, b) => score(b) - score(a))[0];
    return best && quality(best) > 0 ? best : null;
  }

  // Everything the browser provides is passed in, so this runs under test with fakes.
  // `onSpeech({ type: 'start' | 'word' | 'end', word })`, when given, hears the voice as it goes: the
  // assistant's avatar moves its mouth with it.
  // `remote(text, voiceId, params, onSpeech, fallback)`, when given, speaks in a voice of the server's
  // (`voiceName: 'elevenlabs:<id>'`) and returns a function that stops it; `fallback()` speaks the same
  // words in the browser's voice when the server cannot.
  function createNarrator({ params = {}, defaultOn = true, getPref, setPref, synth, Utterance, onSpeech, remote }) {
    const supported = !!(synth && Utterance) || typeof remote === 'function';
    const isOn = () => {
      if (!supported) return false;
      const v = getPref ? getPref(PREF) : null;
      return v === null || v === undefined ? !!defaultOn : v === '1';
    };
    let stopRemote = null;
    const remoteVoice = () => {
      const m = typeof remote === 'function' && String(params.voiceName || '').match(/^elevenlabs:([A-Za-z0-9]{16,32})$/);
      return m ? m[1] : '';
    };
    const cancel = () => {
      if (stopRemote) { const stop = stopRemote; stopRemote = null; try { stop(); } catch (_) { /* already stopped */ } }
      try { if (synth) synth.cancel(); } catch (_) { /* nothing speaking */ }
      if (onSpeech) onSpeech({ type: 'end' });
    };
    const speak = (text) => {
      const t = cleanSpoken(text);
      if (!supported || !t) return false;
      cancel();
      const id = remoteVoice();
      if (id) { stopRemote = remote(t, id, params, onSpeech, () => browserSpeak(t)); return true; }
      return browserSpeak(t);
    };
    const browserSpeak = (t) => {
      if (!synth || !Utterance) return false;
      const u = new Utterance(t);
      for (const k of ['rate', 'pitch', 'volume', 'lang']) if (params[k] !== undefined) u[k] = params[k];
      if (synth.getVoices) {
        const all = synth.getVoices() || [];
        const named = params.voiceName && all.find((x) => x.name.toLowerCase() === String(params.voiceName).toLowerCase());
        const v = named || bestVoice(all, params.lang);
        if (v) u.voice = v;
      }
      if (onSpeech) {
        u.onstart = () => onSpeech({ type: 'start' });
        u.onboundary = (e) => { if (!e || e.name === undefined || e.name === 'word') onSpeech({ type: 'word', word: t.slice(e.charIndex || 0).split(/\s/)[0] }); };
        u.onend = () => onSpeech({ type: 'end' });
        u.onerror = () => onSpeech({ type: 'end' });
      }
      synth.speak(u);
      return true;
    };
    const setOn = (on) => { if (setPref) setPref(PREF, on ? '1' : '0'); if (!on) cancel(); };
    // `reply.spoken` is the assistant's own summary; the first sentences are the fallback.
    const narrate = (reply) => (isOn() ? speak((reply && reply.spoken) || summaryFromHtml(reply && reply.html)) : false);
    return { supported, isOn, setOn, speak, cancel, narrate };
  }

  return { PREF, cleanSpoken, summaryFromHtml, createNarrator, bestVoice };
}));
