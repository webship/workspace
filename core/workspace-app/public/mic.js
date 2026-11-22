// Built from src/browser by `npm run build:browser`: edit the .ts source there, not this file.
"use strict";
(function() {
  "use strict";
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const elementOf = (t) => t instanceof Element ? t : null;
  const given = window.WS_SPEECH ? window.WS_SPEECH.fieldMic : null;
  const cfg = given || null;
  const enabled = () => !!SpeechRecognition && given !== false;
  document.addEventListener("DOMContentLoaded", () => {
    if (!SpeechRecognition) {
      document.querySelectorAll(".mic-btn").forEach((b) => {
        b.hidden = true;
      });
    }
  });
  function dictateInto(btn, field) {
    if (!SpeechRecognition || !enabled() || !field) return;
    const rec = new SpeechRecognition();
    if (cfg && cfg.lang) rec.lang = cfg.lang;
    else if (document.documentElement.lang) rec.lang = document.documentElement.lang;
    rec.interimResults = !!(cfg && cfg.interimResults);
    rec.maxAlternatives = 1;
    btn.classList.add("listening");
    const before = field.value.trim();
    let settled = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const result = ev.results[i];
        if (!result) continue;
        const chunk = result[0] ? result[0].transcript : "";
        if (result.isFinal) settled += chunk;
        else interim += chunk;
      }
      const said = (settled + interim).trim();
      field.value = before ? `${before} ${said}` : said;
      if (field.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length);
    };
    rec.onerror = (ev) => {
      btn.classList.remove("listening");
      const why = {
        "not-allowed": "the browser blocked microphone access for this site",
        "service-not-allowed": "the browser blocked microphone access for this site",
        "language-not-supported": `this browser has no recogniser for ${rec.lang || "the page language"}`,
        "no-speech": "nothing was heard",
        "audio-capture": "no microphone was found"
      }[ev.error];
      if (why) btn.setAttribute("title", `Dictation stopped: ${why}`);
    };
    rec.onend = () => {
      btn.classList.remove("listening");
      field.focus();
    };
    rec.start();
  }
  document.addEventListener("click", (e) => {
    const btn = elementOf(e.target)?.closest(".mic-btn");
    if (!btn || !enabled()) return;
    const form = btn.closest("form");
    dictateInto(btn, form && form.querySelector('input[name="message"]'));
  });
  document.addEventListener("click", (e) => {
    const btn = elementOf(e.target)?.closest(".field-mic");
    if (!btn) return;
    e.preventDefault();
    dictateInto(btn, btn.parentElement ? btn.parentElement.querySelector("input, textarea") : null);
  });
  function addFieldMics(root) {
    if (!enabled()) return;
    const fields = (root && typeof root.querySelectorAll === "function" ? root : document).querySelectorAll(
      'input[type="text"]:not([data-mic]), input:not([type]):not([data-mic]), textarea:not([data-mic])'
    );
    fields.forEach((field) => {
      field.dataset.mic = "1";
      if (field.closest(".chat-input")) return;
      if (field.readOnly || field.disabled) return;
      const parent = field.parentNode;
      if (!parent) return;
      const wrap = document.createElement("span");
      wrap.className = "field-mic-wrap";
      parent.insertBefore(wrap, field);
      wrap.appendChild(field);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "field-mic";
      const own = field.labels && field.labels[0] && field.labels[0].textContent || field.getAttribute("aria-label") || field.getAttribute("placeholder") || "";
      const into = own.replace(/\s+/g, " ").trim().slice(0, 60) || "this field";
      const label = cfg && cfg.lang ? `Dictate into ${into} (${cfg.lang})` : `Dictate into ${into}`;
      btn.title = label;
      btn.setAttribute("aria-label", label);
      btn.innerHTML = '<span uk-icon="icon: microphone; ratio: .7"></span>';
      wrap.appendChild(btn);
    });
  }
  document.addEventListener("DOMContentLoaded", () => addFieldMics());
  document.body.addEventListener("htmx:after:swap", (e) => {
    const detail = e.detail;
    const t = detail && detail.target || elementOf(e.target);
    addFieldMics(t && t.isConnected ? t : void 0);
  });
})();
(function voicePicker() {
  "use strict";
  const mount = () => {
    const select = document.querySelector("select[data-voice-name]");
    const note = document.querySelector("[data-voice-list]");
    if (!select || select.dataset.done) return;
    const lang = window.WS_SPEECH && window.WS_SPEECH.fieldMic && window.WS_SPEECH.fieldMic.lang || "";
    const synth = window.speechSynthesis;
    const render = (voices) => {
      select.dataset.done = "1";
      if (!voices.length) {
        if (note) {
          note.innerHTML = '<span class="uk-text-danger">This browser has no speech voices installed, so nothing will be read aloud whatever this is set to. On Linux that usually means <code>speech-dispatcher</code> and a voice package are missing.</span>';
        }
        return;
      }
      const saved = select.value;
      const preferred = lang ? voices.filter((v) => v.lang && v.lang.replace("_", "-") === lang) : [];
      const rest = voices.filter((v) => !preferred.includes(v));
      const optionFor = (v) => {
        const o = document.createElement("option");
        o.value = v.name;
        o.textContent = `${v.name} — ${v.lang}`;
        return o;
      };
      const groupFor = (label, list) => {
        if (!list.length) return null;
        const g = document.createElement("optgroup");
        g.label = label;
        list.forEach((v) => g.appendChild(optionFor(v)));
        return g;
      };
      [...select.querySelectorAll("option")].forEach((o) => {
        if (o.value !== "default") o.remove();
      });
      const groups = [
        groupFor(lang ? `Voices for ${lang}` : "Voices", preferred),
        groupFor(preferred.length ? "Other languages" : "Voices", rest)
      ].filter((g) => !!g);
      groups.forEach((g) => select.appendChild(g));
      if (saved && saved !== "default") {
        if ([...select.options].some((o) => o.value === saved)) {
          select.value = saved;
        } else {
          const o = document.createElement("option");
          o.value = saved;
          o.textContent = `${saved} — not installed in this browser`;
          select.appendChild(o);
          select.value = saved;
        }
      }
      if (note) {
        note.innerHTML = `<span class="uk-text-meta">${voices.length} voices in this browser${preferred.length ? `, ${preferred.length} for ${lang}` : ""}. Default lets the browser choose one for the dictation language.</span>`;
      }
    };
    const now = synth.getVoices();
    if (now.length) {
      render(now);
      return;
    }
    const timer = setTimeout(() => render(synth.getVoices()), 1500);
    synth.onvoiceschanged = () => {
      clearTimeout(timer);
      render(synth.getVoices());
    };
  };
  if (!window.speechSynthesis) return;
  document.addEventListener("DOMContentLoaded", mount);
  if (document.body) document.body.addEventListener("htmx:after:swap", mount);
})();
