// Built from src/browser by `npm run build:browser`: edit the .ts source there, not this file.
"use strict";
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.wsNarration = factory();
})(globalThis, () => {
  const PREF = "ws-voice";
  const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
  const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m);
  function cleanSpoken(text, max = 300) {
    let t = String(text || "").replace(/https?:\/\/\S+/g, "a link").replace(/[`*_#>|~]/g, " ").replace(/\s+/g, " ").trim();
    if (t.length > max) t = t.slice(0, max).replace(/\s+\S*$/, "");
    return t;
  }
  function summaryFromHtml(html, { maxChars = 240, maxSentences = 2 } = {}) {
    const text = String(html || "").replace(/<div class="plan-card"[\s\S]*$/, " ").replace(/<(pre|table|button|script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|li|h[1-6]|div|tr)>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, "");
    const lines = decode(text).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).map((l) => /[.!?:;]$/.test(l) ? l : `${l}.`);
    const sentences = cleanSpoken(lines.join(" "), 2e3).split(/(?<=[.!?])\s+/).filter(Boolean);
    let out = "";
    for (const s of sentences.slice(0, maxSentences)) {
      if (out && out.length + s.length + 1 > maxChars) break;
      out = out ? `${out} ${s}` : s;
    }
    return cleanSpoken(out, maxChars);
  }
  function bestVoice(voices, lang) {
    const want = String(lang || "en").toLowerCase().slice(0, 2);
    const quality = (v) => (/natural|neural|online/i.test(v.name) ? 8 : 0) + (/google/i.test(v.name) ? 4 : 0) + (/enhanced|premium/i.test(v.name) ? 2 : 0);
    const score = (v) => quality(v) * 2 + (String(v.lang || "").toLowerCase() === String(lang || "").toLowerCase() ? 1 : 0);
    const fit = (voices || []).filter((v) => String(v.lang || "").toLowerCase().startsWith(want));
    const best = fit.sort((a, b) => score(b) - score(a))[0];
    return best && quality(best) > 0 ? best : null;
  }
  function createNarrator({ params = {}, defaultOn = true, getPref, setPref, synth, Utterance, onSpeech, remote }) {
    const supported = !!(synth && Utterance) || typeof remote === "function";
    const isOn = () => {
      if (!supported) return false;
      const v = getPref ? getPref(PREF) : null;
      return v === null || v === void 0 ? !!defaultOn : v === "1";
    };
    let stopRemote = null;
    const remoteVoice = () => {
      const m = typeof remote === "function" && String(params.voiceName || "").match(/^elevenlabs:([A-Za-z0-9]{16,32})$/);
      return m ? m[1] ?? "" : "";
    };
    const cancel = () => {
      if (stopRemote) {
        const stop = stopRemote;
        stopRemote = null;
        try {
          stop();
        } catch (_) {
        }
      }
      try {
        if (synth) synth.cancel();
      } catch (_) {
      }
      if (onSpeech) onSpeech({ type: "end" });
    };
    const speak = (text) => {
      const t = cleanSpoken(text);
      if (!supported || !t) return false;
      cancel();
      const id = remoteVoice();
      if (id && remote) {
        stopRemote = remote(t, id, params, onSpeech, () => browserSpeak(t));
        return true;
      }
      return browserSpeak(t);
    };
    const browserSpeak = (t) => {
      if (!synth || !Utterance) return false;
      const u = new Utterance(t);
      if (params.rate !== void 0) u.rate = params.rate;
      if (params.pitch !== void 0) u.pitch = params.pitch;
      if (params.volume !== void 0) u.volume = params.volume;
      if (params.lang !== void 0) u.lang = params.lang;
      if (synth.getVoices) {
        const all = synth.getVoices() || [];
        const named = params.voiceName && all.find((x) => x.name.toLowerCase() === String(params.voiceName).toLowerCase());
        const v = named || bestVoice(all, params.lang);
        if (v) u.voice = v;
      }
      if (onSpeech) {
        u.onstart = () => onSpeech({ type: "start" });
        u.onboundary = (e) => {
          if (!e || e.name === void 0 || e.name === "word") onSpeech({ type: "word", word: t.slice(e && e.charIndex || 0).split(/\s/)[0] });
        };
        u.onend = () => onSpeech({ type: "end" });
        u.onerror = () => onSpeech({ type: "end" });
      }
      synth.speak(u);
      return true;
    };
    const setOn = (on) => {
      if (setPref) setPref(PREF, on ? "1" : "0");
      if (!on) cancel();
    };
    const narrate = (reply) => isOn() ? speak(reply && reply.spoken || summaryFromHtml(reply && reply.html)) : false;
    return { supported, isOn, setOn, speak, cancel, narrate };
  }
  return { PREF, cleanSpoken, summaryFromHtml, createNarrator, bestVoice };
});
