/* The small microphone beside every text field.
 *
 * A different thing from the assistant's microphone: that one is deep-chat's, configured as an
 * object and drawn inside its shadow root. These are plain `SpeechRecognition`, added to every field
 * worth typing into — 36 of them on the settings page alone — and they came first.
 *
 * They used to pin themselves to `document.documentElement.lang`, which meant `speech_language` in
 * settings.yml moved the assistant and left every other microphone on English. That is the failure
 * this whole setting exists to prevent: a recogniser on the wrong language does not error, it returns
 * confident nonsense, so the bug looks like bad dictation rather than a configuration problem. Both
 * kinds of microphone now read the same resolved config, from speech.js, through `window.WS_SPEECH`.
 */

(function () {
  'use strict';

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Resolved server-side by speech.js. Absent only if the page failed to render its head, in which
  // case the browser's own defaults are the right fallback rather than refusing to work.
  const cfg = (window.WS_SPEECH && window.WS_SPEECH.fieldMic) || null;
  const enabled = () => !!SpeechRecognition && cfg !== false;

  document.addEventListener('DOMContentLoaded', () => {
    if (!SpeechRecognition) {
      document.querySelectorAll('.mic-btn').forEach((b) => { b.hidden = true; });
    }
  });

  /** Dictate into a field. Shared by the composer's round mic and every field mic. */
  function dictateInto(btn, field) {
    if (!enabled() || !field) return;
    const rec = new SpeechRecognition();

    // An empty lang is left UNSET rather than assigned "": SpeechRecognition treats an empty string
    // as a language it cannot match, where an unset one correctly means "use the browser's".
    if (cfg && cfg.lang) rec.lang = cfg.lang;
    else if (document.documentElement.lang) rec.lang = document.documentElement.lang;

    rec.interimResults = !!(cfg && cfg.interimResults);
    rec.maxAlternatives = 1;
    btn.classList.add('listening');

    // What was in the field before this started. Interim results rewrite the tail as the recogniser
    // changes its mind, so the original has to be remembered rather than read back each time — with
    // interim results on, reading the live value would compound each guess onto the last.
    const before = field.value.trim();
    let settled = '';

    rec.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const chunk = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) settled += chunk;
        else interim += chunk;
      }
      const said = (settled + interim).trim();
      // Append rather than replace: a field may already hold something typed, and losing it to a
      // stray mic press is worse than a long value.
      field.value = before ? `${before} ${said}` : said;
      if (field.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length);
    };

    // Silence, a denied microphone and an unsupported language all arrive here. Saying which is
    // worth the two lines: "no-speech" means try again, "not-allowed" means a browser permission
    // nobody can guess at, and "language-not-supported" is a setting to change.
    rec.onerror = (ev) => {
      btn.classList.remove('listening');
      const why = {
        'not-allowed': 'the browser blocked microphone access for this site',
        'service-not-allowed': 'the browser blocked microphone access for this site',
        'language-not-supported': `this browser has no recogniser for ${rec.lang || 'the page language'}`,
        'no-speech': 'nothing was heard',
        'audio-capture': 'no microphone was found',
      }[ev.error];
      if (why) btn.setAttribute('title', `Dictation stopped: ${why}`);
    };

    rec.onend = () => {
      btn.classList.remove('listening');
      field.focus();
    };

    rec.start();
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mic-btn');
    if (!btn || !enabled()) return;
    const form = btn.closest('form');
    dictateInto(btn, form && form.querySelector('input[name="message"]'));
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.field-mic');
    if (!btn) return;
    e.preventDefault();          // it lives inside forms; it must never submit one
    dictateInto(btn, btn.parentElement.querySelector('input, textarea'));
  });

  /* Give every field that wants typing a mic, rather than hand-adding markup to each one —
   * including fields that arrive later in an HTMX fragment.
   *
   * Skipped: the composer, which has its own round mic; anything not typed into (checkbox, select,
   * file, hidden); and password fields, where dictating a secret aloud is not something to offer.
   */
  function addFieldMics(root) {
    if (!enabled()) return;
    const fields = (root || document).querySelectorAll(
      'input[type="text"]:not([data-mic]), input:not([type]):not([data-mic]), textarea:not([data-mic])');
    fields.forEach((field) => {
      field.dataset.mic = '1';
      if (field.closest('.chat-input')) return;
      if (field.readOnly || field.disabled) return;
      const wrap = document.createElement('span');
      wrap.className = 'field-mic-wrap';
      field.parentNode.insertBefore(wrap, field);
      wrap.appendChild(field);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'field-mic';
      // The language is named in the tooltip. Dictation that produces nonsense looks like a broken
      // microphone; seeing "Dictate (Arabic (Jordan))" is what turns it into a setting to check.
      const label = (cfg && cfg.lang) ? `Dictate into this field (${cfg.lang})` : 'Dictate into this field';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.innerHTML = '<span uk-icon="icon: microphone; ratio: .7"></span>';
      wrap.appendChild(btn);
    });
  }

  document.addEventListener('DOMContentLoaded', () => addFieldMics());
  document.body.addEventListener('htmx:after:swap', (e) => {
    const t = (e.detail && e.detail.target) || e.target;
    addFieldMics(t && t.isConnected ? t : undefined);
  });
}());

/* What voices this browser actually has, shown where the setting asks for one.
 *
 * Two problems, one answer.
 *
 * `voice_name` asks for a name spelled exactly as the browser spells it — "Google US English",
 * "Microsoft Zira - English (United States)" — and the lists differ per browser, per OS and per
 * install. Asking someone to type one blind is asking them to guess.
 *
 * Worse, a browser with NO voices installed fails silently. `speechSynthesis` exists, `speak()`
 * accepts the utterance, and the only sign is an `error: synthesis-failed` nobody is listening for.
 * Headless Chromium has none; so does a Linux desktop without speech-dispatcher. The read-aloud
 * setting then looks switched on and does nothing at all, which is the worst state a setting can be
 * in — so if there are none, this says so instead of leaving a silent success.
 */
(function voicePicker() {
  'use strict';

  /* Fill the reading-voice dropdown with the voices this browser actually has.
   *
   * The server cannot do it: which voices exist is a property of the browser and the OS, they differ
   * per machine, and the names are exact strings ("Microsoft Zira - English (United States)"). So the
   * server renders the select with the saved value and this adds the rest.
   *
   * The dictation language leads the order. `voice_name: default` means "let the browser choose for
   * the language we set", which with en-US pinned is an en-US voice — so the voices for that language
   * are the ones offered first, and the rest are still reachable below them.
   *
   * A browser with NO voices fails silently: `speechSynthesis` exists, `speak()` accepts the
   * utterance, and the only sign is an `error: synthesis-failed` nobody is listening for. Headless
   * Chromium has none, and so does a Linux desktop without speech-dispatcher — the read-aloud setting
   * then looks switched on and does nothing at all. That case says so rather than leaving an empty
   * dropdown that reads as "still loading".
   */
  const mount = () => {
    const select = document.querySelector('select[data-voice-name]');
    const note = document.querySelector('[data-voice-list]');
    if (!select || select.dataset.done) return;

    const lang = (window.WS_SPEECH && window.WS_SPEECH.fieldMic && window.WS_SPEECH.fieldMic.lang) || '';

    const render = (voices) => {
      select.dataset.done = '1';

      if (!voices.length) {
        if (note) {
          note.innerHTML = '<span class="uk-text-danger">This browser has no speech voices installed, '
            + 'so nothing will be read aloud whatever this is set to. On Linux that usually means '
            + '<code>speech-dispatcher</code> and a voice package are missing.</span>';
        }
        return;
      }

      const saved = select.value;
      // Voices for the dictation language first — with en-US pinned, those are the ones anybody
      // picking a "reading voice" actually means.
      const preferred = lang ? voices.filter((v) => v.lang && v.lang.replace('_', '-') === lang) : [];
      const rest = voices.filter((v) => !preferred.includes(v));

      const optionFor = (v) => {
        const o = document.createElement('option');
        o.value = v.name;
        o.textContent = `${v.name} — ${v.lang}`;
        return o;
      };
      const groupFor = (label, list) => {
        if (!list.length) return null;
        const g = document.createElement('optgroup');
        g.label = label;
        list.forEach((v) => g.appendChild(optionFor(v)));
        return g;
      };

      // Keep the "default" entry and drop the placeholder copy of the saved value; it comes back as
      // a real option below if the browser still has that voice.
      [...select.querySelectorAll('option')].forEach((o) => { if (o.value !== 'default') o.remove(); });
      const groups = [
        groupFor(lang ? `Voices for ${lang}` : 'Voices', preferred),
        groupFor(preferred.length ? 'Other languages' : 'Voices', rest),
      ].filter(Boolean);
      groups.forEach((g) => select.appendChild(g));

      if (saved && saved !== 'default') {
        if ([...select.options].some((o) => o.value === saved)) {
          select.value = saved;
        } else {
          // The saved voice is not installed here. Keep it and say so rather than silently switching
          // to something else — the file says one thing and the form must not quietly say another.
          const o = document.createElement('option');
          o.value = saved;
          o.textContent = `${saved} — not installed in this browser`;
          select.appendChild(o);
          select.value = saved;
        }
      }

      if (note) {
        note.innerHTML = `<span class="uk-text-meta">${voices.length} voices in this browser`
          + `${preferred.length ? `, ${preferred.length} for ${lang}` : ''}. `
          + 'Default lets the browser choose one for the dictation language.</span>';
      }
    };

    // getVoices() is empty until the engine has enumerated them, and `voiceschanged` may never fire
    // when there are none — so the timeout is the answer for "none", not a fallback for slowness.
    const now = window.speechSynthesis.getVoices();
    if (now.length) return render(now);
    const timer = setTimeout(() => render(window.speechSynthesis.getVoices()), 1500);
    window.speechSynthesis.onvoiceschanged = () => {
      clearTimeout(timer);
      render(window.speechSynthesis.getVoices());
    };
  };

  if (!window.speechSynthesis) return;
  document.addEventListener('DOMContentLoaded', mount);
  document.body && document.body.addEventListener('htmx:after:swap', mount);
}());
