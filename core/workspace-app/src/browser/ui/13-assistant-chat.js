/* ---------------- the AI assistant, as a deep-chat component ------------ */

// deep-chat is configured with properties rather than attributes: anything that is not a string
// (the connect object, the style maps, the interceptor) cannot survive an attribute.
(function initDeepChat() {
  const el = document.getElementById('ws-deep-chat');
  if (!el || el.dataset.wsReady) return;
  el.dataset.wsReady = '1';

  const context = el.dataset.context || 'home';
  // What the settings file says about this panel. A missing or unreadable attribute falls back to
  // the same defaults the resolver uses, so the panel still works if the settings never arrive.
  let cfg = { voiceInput: true, submitAfterSilence: 2500, voiceOutput: true, speechRate: 1, placeholder: '' };
  try { cfg = { ...cfg, ...JSON.parse(el.dataset.settings || '{}') }; } catch (_) { /* keep the defaults */ }

  el.connect = {
    url: '/actions/deep-chat',
    method: 'POST',
    additionalBodyProps: { context },
  };

  // The conversation carries across pages. Every page draws a new deep-chat, so the transcript has
  // to be handed back to it: the server keeps the thread (the id is a cookie on the hub domain, the
  // only thing that crosses <workspace>.<hub> subdomains) and returns it in deep-chat's own history
  // shape. Fetched rather than rendered into the page because the panel is built in pageShell, which
  // does not see the request — and it is one small same-origin GET either way.
  //
  // The agent's own memory is the other half, and it is the server's: it resumes the claude session
  // this thread started. A transcript in front of an agent that remembers none of it reads as memory
  // and is not.
  // Suggested prompts: shown only when the saved conversation is empty.
  const suggestions = Array.isArray(cfg.suggestions)
    ? cfg.suggestions.filter((s) => typeof s === 'string' && s.trim()) : [];
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // A click fills the composer and never sends (the assistant has a shell).
  const fillComposer = (text) => {
    const input = el.shadowRoot && el.shadowRoot.querySelector('#text-input');
    if (!input) return;
    const existing = (input.innerText || '').trim();
    input.innerText = existing ? `${existing} ${text}` : text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // deep-chat draws inside a shadow root, so the look and the click are attached by class here.
  el.htmlClassUtilities = {
    ...(el.htmlClassUtilities || {}),
    'ws-suggestion': {
      events: { click: (event) => fillComposer((event.currentTarget || event.target).textContent.trim()) },
      styles: {
        default: {
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          margin: '0 0 0.35rem', padding: '0.45rem 0.7rem', borderRadius: '0.6rem',
          border: '1px solid var(--line)', background: 'var(--surface-input)', color: 'var(--text-default)',
          fontFamily: 'var(--font-primary)', fontSize: '0.88rem', lineHeight: '1.4',
        },
        hover: { borderColor: 'var(--brand-primary)', color: 'var(--brand-primary)' },
      },
    },
  };

  // deep-chat-temporary-message: removed when the next message arrives, never saved to the thread.
  let suggestTries = 0;
  let conversationEmpty = true;
  const suggestOn = () => (window.wsPref ? window.wsPref('ws-suggest', null) : null) !== '0';
  const showSuggestions = () => {
    if (!suggestions.length || el.dataset.wsSuggested || !suggestOn()) return;
    el.dataset.wsSuggested = '1';
    const html = `<div class="deep-chat-temporary-message ws-suggestions">${
      suggestions.map((s) => `<button type="button" class="ws-suggestion">${escapeHtml(s)}</button>`).join('')}</div>`;
    try { el.addMessage({ role: 'ai', html }); }
    catch (_) {
      // The component may not be ready yet.
      delete el.dataset.wsSuggested;
      if ((suggestTries += 1) < 8) setTimeout(showSuggestions, 400);
    }
  };

  const hideSuggestions = () => {
    const box = el.shadowRoot && el.shadowRoot.querySelector('.ws-suggestions');
    const outer = box && box.closest('[class*="outer-message-container"]');
    if (outer) outer.remove();
    delete el.dataset.wsSuggested;
  };

  fetch('/fragments/chat/history', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data && Array.isArray(data.messages) && data.messages.length) { conversationEmpty = false; el.history = data.messages; }
      else showSuggestions();
    })
    .catch(() => { showSuggestions(); });

  // Voice summary: the checkbox in the assistant options. The choice is kept per browser; settings.yml
  // only sets where it starts.
  // The narration's voice settings, kept by reference: the avatar's settings change its volume live.
  const narrationParams = { ...(cfg.narration || {}) };
  // settings.yml never makes an ElevenLabs voice the default: that spends credits, so it is picked in the avatar's settings.
  if (/^elevenlabs:/i.test(String(narrationParams.voiceName || ''))) delete narrationParams.voiceName;
  // What someone chose in the avatar's settings: volume, speed, pitch and the voice. An empty cookie means
  // not chosen, never 0, which would silence the voice.
  const VOICE_PREFS = { volume: ['ws-voice-volume', 0, 1], rate: ['ws-voice-rate', 0.5, 2], pitch: ['ws-voice-pitch', 0, 2] };
  for (const [key, [name, min, max]] of Object.entries(VOICE_PREFS)) {
    try { const raw = window.wsPref ? window.wsPref(name, '') : ''; const v = Number(raw); if (raw !== '' && raw !== null && Number.isFinite(v) && v >= min && v <= max) narrationParams[key] = v; } catch (_) { /* default */ }
  }
  try { const vn = window.wsPref ? window.wsPref('ws-voice-name', '') : ''; if (vn) narrationParams.voiceName = vn; } catch (_) { /* best free voice */ }
  const narrator = window.wsNarration.createNarrator({
    params: narrationParams,
    defaultOn: cfg.voiceOutput !== false,
    getPref: (name) => (window.wsPref ? window.wsPref(name, null) : null),
    setPref: wsPrefSet,
    synth: window.speechSynthesis,
    Utterance: window.SpeechSynthesisUtterance,
    onSpeech: (detail) => document.dispatchEvent(new CustomEvent('ws-assistant-speech', { detail })),
    // An ElevenLabs voice: the server speaks (its key never comes here) and this plays the audio, at the
    // chosen volume and speed. The words are spread over the clip so the avatar's mouth keeps moving.
    // When the server cannot, the same words are spoken in the browser's voice instead.
    remote: (text, voiceId, params, onSpeech, fallback) => {
      let stopped = false; let audio = null; let url = '';
      const ctl = new AbortController();
      const words = text.split(/\s+/);
      const done = () => { if (url) URL.revokeObjectURL(url); url = ''; if (onSpeech) onSpeech({ type: 'end' }); };
      fetch('/actions/assistant/speak', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: voiceId, text }) })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => {
          if (stopped) return;
          url = URL.createObjectURL(blob);
          audio = new Audio(url);
          audio.volume = Number.isFinite(params.volume) ? params.volume : 1;
          audio.playbackRate = Number.isFinite(params.rate) ? params.rate : 1;
          let said = -1;
          audio.onplay = () => { if (onSpeech) onSpeech({ type: 'start' }); };
          audio.ontimeupdate = () => {
            const i = Math.floor((audio.currentTime / (audio.duration || 1)) * words.length);
            if (i !== said && i < words.length) { said = i; if (onSpeech) onSpeech({ type: 'word', word: words[i] }); }
          };
          audio.onended = done;
          audio.onerror = done;
          return audio.play();
        })
        .catch(() => { if (!stopped) fallback(); });
      return () => { stopped = true; ctl.abort(); if (audio) { audio.pause(); audio.src = ''; } if (url) { URL.revokeObjectURL(url); url = ''; } };
    },
  });
  window.addEventListener('pagehide', narrator.cancel);
  // The assistant's avatar (assistant-avatar-ui.js) mutes and unmutes this voice, and hides it.
  window.wsAssistantVoice = {
    isOn: narrator.isOn, setOn: narrator.setOn, cancel: narrator.cancel, speak: narrator.speak,
    volume: () => (Number.isFinite(narrationParams.volume) ? narrationParams.volume : 1),
    setVolume: (v) => { narrationParams.volume = Math.max(0, Math.min(1, Number(v))); try { wsPrefSet('ws-voice-volume', String(narrationParams.volume)); } catch (_) { /* not kept */ } },
    get: (key) => narrationParams[key],
    set: (key, value) => {
      if (key === 'voiceName') { narrationParams.voiceName = String(value || ''); try { wsPrefSet('ws-voice-name', narrationParams.voiceName); } catch (_) { /* not kept */ } return; }
      if (!VOICE_PREFS[key]) return;
      const [name, min, max] = VOICE_PREFS[key];
      narrationParams[key] = Math.max(min, Math.min(max, Number(value)));
      try { wsPrefSet(name, String(narrationParams[key])); } catch (_) { /* not kept */ }
    },
  };
  el.requestInterceptor = (details) => {
    let body = { ...details.body, voice: narrator.isOn(), avatar: Boolean(window.wsAssistantAvatarOn && window.wsAssistantAvatarOn()), avatarName: window.wsAvatarName ? window.wsAvatarName() : '', avatarId: window.wsAvatarId ? window.wsAvatarId() : '', page: window.wsAvatarContext ? window.wsAvatarContext() : null };
    // A plugin's script may add to what a turn carries (window.wsAssistantHooks.beforeSend): a function
    // is given the body and returns it, or nothing to leave it as it is.
    for (const fn of (window.wsAssistantHooks && window.wsAssistantHooks.beforeSend) || []) {
      try { const next = fn(body); if (next && typeof next === 'object') body = next; } catch (_) { /* a plugin's mistake must not stop a turn */ }
    }
    details.body = body;
    return details;
  };
  const playSendAnimation = () => {
    const btn = el.shadowRoot && el.shadowRoot.querySelector('.input-button.inside-end');
    if (!btn) return;
    btn.classList.remove('ws-sent');
    void btn.offsetWidth;
    btn.classList.add('ws-sent');
    setTimeout(() => btn.classList.remove('ws-sent'), 700);
  };
  // Working: from a message being sent until the answer, or an error, comes back.
  let workingTimer = null;
  const setWorking = (on, failed = false) => {
    clearTimeout(workingTimer);
    el.toggleAttribute('data-assistant-working', on);
    document.dispatchEvent(new CustomEvent('ws-assistant-working', { detail: { on, failed } }));
    document.querySelectorAll('.assistant-panel').forEach((p) => p.toggleAttribute('data-working', on));
    if (on) workingTimer = setTimeout(() => setWorking(false), 16 * 60 * 1000);
  };
  el.onMessage = ({ message, isHistory }) => {
    if (isHistory || !message) return;
    if (message.role === 'user') { conversationEmpty = false; narrator.cancel(); playSendAnimation(); setWorking(true); }
    else setWorking(false);
  };
  el.onError = () => setWorking(false, true);

  // What a plugin's script reaches: send a turn as if it were typed, and add to a turn's body.
  window.wsAssistantHooks = window.wsAssistantHooks || {};
  if (!Array.isArray(window.wsAssistantHooks.beforeSend)) window.wsAssistantHooks.beforeSend = [];
  window.wsAssistantSend = (text) => {
    const words = String(text || '').trim();
    if (!words) return false;
    try { el.submitUserMessage({ text: words }); return true; }
    catch (_) { try { el.submitUserMessage(words); return true; } catch (__) { return false; } }
  };

  // The reply arrives as rendered markdown plus the directives the assistant ended with. Acting on
  // them here keeps the interface steering that the HTMX pane had: the agent can start a project
  // and then take you to it.
  el.responseInterceptor = (response) => {
    const d = response && response.directive;
    if (d) {
      if (d.refresh) document.body.dispatchEvent(new CustomEvent('refresh-projects'));
      if (d.open) window.open(d.open, '_blank', 'noopener');
      if (d.navigate) setTimeout(() => { window.location.href = d.navigate; }, 600);
    }
    // A plugin's script that speaks the answer itself (sentence by sentence, in a voice of its own) says
    // so by cancelling this event; left alone, the summary voice speaks as before.
    const answer = new CustomEvent('ws-assistant-answer', { cancelable: true, detail: { html: (response && response.html) || '', spoken: (d && d.spoken) || '', directive: d || null } });
    const speakHere = document.dispatchEvent(answer);
    setWorking(false);
    if (response && response.html) { if (speakHere) narrator.narrate({ spoken: d && d.spoken, html: response.html }); }
    document.dispatchEvent(new CustomEvent('ws-assistant-reply', { detail: { directive: d || null, voice: narrator.isOn() } }));
    return response;
  };

  // Voice in and out, exactly as speech.js resolved them.
  //
  // The page does not build these objects any more. Which keys may be absent is the substance of
  // that config — an empty `commands` phrase arms a command rather than disabling one, and
  // `substrings` defaults to true so "submit the form" would fire mid-sentence — and those rules
  // belong somewhere a test can require, not in a browser file that can only be checked by reading
  // it. `false` here means the microphone is removed rather than left as a button that does nothing.
  if (cfg.speechToText !== undefined) el.speechToText = cfg.speechToText;
  el.textToSpeech = false;   // narration is the voice summary above; deep-chat's own never speaks an HTML reply

  // The prompt is the main control of this panel, so it is sized like one rather than like a
  // single-line search box: room for a few lines of a real instruction before it scrolls.
  el.textInput = {
    // Whatever `assistant: placeholder:` says, and by default nothing visible: an empty field with
    // a cursor in it already says "type here", and a prompt that suggests what to ask narrows what
    // gets asked.
    //
    // "Nothing" cannot be spelled as an empty string. deep-chat reads this as
    // `placeholder.text || "Ask me anything!"`, so a blank does not remove its placeholder, it
    // restores deep-chat's — which is how "Ask me anything!" was showing on a panel configured to
    // say nothing. The text it IS given becomes the composer's aria-label as well, so with nothing
    // to display this carries the accessible name a textbox needs and `hidePlaceholder` below
    // blanks what is drawn. Configure one and it is both the visible text and the name.
    placeholder: { text: cfg.placeholder || `Message the ${cfg.name || 'AI Assistant'}` },
    styles: {
      container: {
        minHeight: '4.5rem',
        maxHeight: '11rem',
        borderRadius: '0.85rem',
        padding: '0.65rem 0.9rem',
        boxShadow: '0 1px 2px rgba(0,0,0,.06)',
        // Tokens, not values. deep-chat writes these as inline styles inside its shadow root,
        // and a custom property inherits THROUGH a shadow boundary from the host — so var()
        // here resolves against :root and follows the theme, both halves, with no second copy
        // of this object for dark and no re-render when the toggle is pressed.
        backgroundColor: 'var(--surface-input)',
        border: '1px solid var(--line)',
        color: 'var(--text-default)',
      },
      text: { fontSize: '1rem', lineHeight: '1.45', fontFamily: 'var(--font-primary)' },
    },
  };

  // deep-chat's own send and microphone are role="button" with an SVG inside and no accessible name,
  // so a screen reader announces two unnamed buttons at the end of the composer — axe's
  // aria-command-name, on every page the panel is on. They live in the component's shadow root, which
  // is reachable but not ours to edit, so the names are set from here rather than by forking the
  // vendored bundle.
  const nameChatButtons = () => {
    const root = el.shadowRoot;
    if (!root) return;
    const names = [
      ['#microphone-button', 'Dictate the message'],
      ['.input-button.inside-end', 'Send the message'],
      ['#submit-icon', 'Send the message'],
    ];
    for (const [sel, label] of names) {
      for (const node of root.querySelectorAll(sel)) {
        if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', label);
      }
    }
  };
  // The two things deep-chat insists on drawing, turned off from inside its shadow root.
  //
  // Both are there because the component treats "nothing" as "not configured" and substitutes its
  // own: an empty `placeholder.text` restores "Ask me anything!", and an unset `introMessage`
  // restores the library placeholder about connect and the demo property. So both are SET, to the
  // emptiest thing that still suppresses the default, and what is left to draw is hidden here.
  //
  //   - The placeholder is `content: attr(deep-chat-placeholder-text)` on the empty input, coloured
  //     by a rule of deep-chat's own, so neither an empty string nor a colour on the input turns it
  //     off. Blanking that one pseudo-element does, and it leaves the attribute — and the aria-label
  //     built from it — in place: silent on screen, named to a screen reader. A configured
  //     placeholder skips this and is drawn normally.
  //   - The intro message is an empty <span>, and an empty span in a message bubble is still a
  //     bubble: a small blank pill at the top of every transcript, which reads as a message that
  //     failed to load.
  const chatChrome = () => {
    const root = el.shadowRoot;
    if (!root || root.getElementById('ws-chat-chrome')) return;
    const st = document.createElement('style');
    st.id = 'ws-chat-chrome';
    st.textContent = '.deep-chat-intro { display: none !important; }'
      + (cfg.placeholder ? '' : '\n#text-input:empty::before { content: "" !important; }')
      + '\n:host([data-assistant-mic="off"]) #microphone-button { display: none !important; }';
    root.appendChild(st);
  };
  // Watched, not timed: the component builds and rebuilds those buttons whenever the composer changes,
  // so a handful of setTimeouts named them on one page load and missed them on the next.
  nameChatButtons();
  chatChrome();
  if (el.shadowRoot && window.MutationObserver) {
    new MutationObserver(() => { nameChatButtons(); chatChrome(); })
      .observe(el.shadowRoot, { childList: true, subtree: true });
  } else {
    setTimeout(() => { nameChatButtons(); chatChrome(); }, 500);
  }

  // No opening message, and none of deep-chat's own either. Left unset, the component renders its
  // library placeholder — the one about connect, directConnection and the demo property — which is
  // documentation for whoever is building a chat, not for whoever is using this one. An empty
  // introMessage is what keeps that out without putting anything of ours in its place; the bubble
  // it still draws around that emptiness is hidden by `chatChrome` above.
  el.introMessage = { html: '<span></span>' };


  // A build is minutes of work, so the component must not give up on the request.
  //
  // The look, in the Webship design system rather than deep-chat's stock preset: the user's turn
  // carries the same brand gradient as the rest of the interface, and the assistant's sits on a
  // plain card surface so long technical replies stay readable. Every colour here is a token —
  // the component shipped a fixed purple gradient and a fixed near-white bubble, which meant the
  // panel was a different product from the page around it and stayed light after dark.
  el.messageStyles = {
    default: {
      shared: {
        bubble: {
          maxWidth: '92%',
          borderRadius: '0.85rem',
          padding: '0.6rem 0.85rem',
          marginTop: '0.35rem',
          marginBottom: '0.35rem',
          fontSize: '0.95rem',
          lineHeight: '1.5',
          fontFamily: 'var(--font-primary)',
        },
      },
      user: {
        bubble: {
          background: 'var(--brand-grad)',
          color: 'var(--text-inverse)',
        },
      },
      ai: {
        bubble: { backgroundColor: 'var(--surface-muted)', color: 'var(--text-default)' },
      },
    },
    // Since 2.1.0 the loading bubble is styled through its own shape, not a plain bubble object.
    loading: { message: { styles: { bubble: { backgroundColor: 'var(--surface-muted)' } } } },
    error: { bubble: { backgroundColor: 'var(--danger-soft)', color: 'var(--danger-ink)', fontSize: '0.9rem' } },
  };

  // Injected into the component's shadow root, which is the only way to reach what deep-chat
  // renders inside itself: the typeface, and the typography of the markdown we return.
  //
  // deep-chat's own default is Inter. The dashboard is Figtree, per the brand tokens, so the
  // one panel a person actually reads sentences in was the one panel not in the brand face. The
  // wildcard is deliberate: the component builds its own buttons, toolbar and placeholder, and
  // none of them inherit from the page across the shadow boundary.
  el.auxiliaryStyle = `
    * { font-family: var(--font-primary); }
    /* deep-chat's own chrome, which its style properties do not reach: the panel it draws behind
       the transcript, the input shell, the two round buttons and the tooltip. Left alone they are
       a white panel and a lilac microphone — the component's brand, not ours, and both stayed
       light after dark. */
    #chat-view, #input { background-color: transparent !important; }
    /* A field's edge at 3:1 and a ring while it has focus, as every other field has (base.css): the
       stylesheet does not reach into this shadow root, so the composer kept --line (1.35:1) and showed
       nothing when Tab reached it. */
    #text-input-container { background-color: var(--surface-input) !important; border: 1px solid color-mix(in srgb, var(--text-subtle) 70%, var(--surface-card)) !important; }
    #text-input-container:focus-within { border-color: var(--link) !important; outline: 2px solid var(--link); outline-offset: 2px; }
    #text-input { color: var(--text-default) !important; }
    #text-input[textinputplaceholderstyle] { color: var(--text-subtle) !important; }
    .input-button-svg { background-color: var(--surface-muted) !important; }
    #microphone-button { background: var(--brand-grad) !important; }
    #microphone-button.active { background: var(--danger) !important; }
    .tooltip { background-color: var(--code-bg) !important; color: var(--code-ink) !important; }
    .dc-reply p { margin: 0 0 .5rem; }
    .dc-reply p:last-child { margin-bottom: 0; }
    .dc-reply pre { background: var(--code-bg); color: var(--code-ink); padding: .5rem .65rem; border-radius: .5rem; overflow-x: auto; }
    .dc-reply code, .dc-reply pre, .dc-reply pre * { font-family: var(--font-code); font-size: .88em; }
    .dc-reply a { color: var(--link); }
    .dc-reply table { border-collapse: collapse; width: 100%; font-size: .9em; }
    .dc-reply th, .dc-reply td { border: 1px solid var(--line); padding: .3rem .45rem; text-align: left; }
    .input-button.inside-end { transition: transform .08s; }
    .input-button.inside-end:active { transform: scale(.92); }
    .input-button.inside-end.ws-sent svg { animation: ws-send-fly .6s cubic-bezier(.4, 0, .2, 1); }
    @keyframes ws-send-fly {
      0%   { translate: 0 0; scale: 1; opacity: 1; }
      40%  { translate: 10px -10px; scale: .8; opacity: 0; }
      41%  { translate: -10px 10px; scale: .8; opacity: 0; }
      100% { translate: 0 0; scale: 1; opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) { .input-button.inside-end.ws-sent svg { animation: none; } }
    .input-button.inside-end svg { transition: opacity .15s; }
    :host([data-assistant-working]) .input-button.inside-end { position: relative !important; }
    :host([data-assistant-working]) .input-button.inside-end.disabled-button { opacity: 1; }
    :host([data-assistant-working]) .input-button.inside-end svg { opacity: 0; }
    :host([data-assistant-working]) .loading-submit-button { display: none !important; }
    :host([data-assistant-working]) .input-button.inside-end::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background-image: radial-gradient(circle, var(--text-inverse) 2.4px, transparent 2.9px), radial-gradient(circle, var(--text-inverse) 2.4px, transparent 2.9px), radial-gradient(circle, var(--text-inverse) 2.4px, transparent 2.9px);
      background-size: 8px 8px; background-repeat: no-repeat;
      background-position: calc(50% - 9px) 55%, 50% 55%, calc(50% + 9px) 55%;
      animation: ws-dots 1.2s ease-in-out infinite;
    }
    @keyframes ws-dots {
      0%, 60%, 100% { background-position: calc(50% - 9px) 55%, 50% 55%, calc(50% + 9px) 55%; }
      15% { background-position: calc(50% - 9px) 30%, 50% 55%, calc(50% + 9px) 55%; }
      30% { background-position: calc(50% - 9px) 55%, 50% 30%, calc(50% + 9px) 55%; }
      45% { background-position: calc(50% - 9px) 55%, 50% 55%, calc(50% + 9px) 30%; }
    }
    @media (prefers-reduced-motion: reduce) { :host([data-assistant-working]) .input-button.inside-end::after { animation: none; } }
  `;

  el.requestBodyLimits = { maxMessages: 1 };

  // Prompt mode lives in deep-chat's own input toolbar, beside the send button, the way
  // ai_agent_modes puts its compact selector in the message box toolbar. deep-chat builds that
  // toolbar itself, so the select is rendered in the page and moved in once it exists.
  const picker = document.querySelector('.chat-tools .command-picker');

  // The check buttons in the assistant options. Each is kept per browser; the settings only say where it starts.
  const savedSwitch = (name, start) => {
    const v = window.wsPref ? window.wsPref(name, null) : null;
    return v === null || v === undefined ? start : v === '1';
  };
  const prefSwitch = (name, start, apply) => ({
    get: () => savedSwitch(name, start),
    set: (on) => { wsPrefSet(name, on ? '1' : '0'); apply(on); },
    init: () => apply(savedSwitch(name, start)),
  });
  const switches = {
    voice: {
      show: narrator.supported, get: narrator.isOn,
      set: (on) => { narrator.setOn(on); if (on) narrator.speak('Voice summary on.'); },
    },
    mic: {
      show: cfg.speechToText !== false,
      ...prefSwitch('ws-mic', cfg.voiceInput !== false, (on) => (on ? el.removeAttribute('data-assistant-mic') : el.setAttribute('data-assistant-mic', 'off'))),
    },
    mode: {
      show: !!picker,
      ...prefSwitch('ws-mode', true, (on) => { if (picker) picker.style.display = on ? '' : 'none'; }),
    },
    suggest: {
      show: suggestions.length > 0,
      ...prefSwitch('ws-suggest', true, (on) => { if (on) { if (conversationEmpty) showSuggestions(); } else hideSuggestions(); }),
      init: null,   // showSuggestions already reads the saved choice once the history has loaded
    },
  };
  document.querySelectorAll('.assistant-switch').forEach((box) => {
    const sw = switches[box.dataset.switch];
    if (!sw || !sw.show) { box.closest('li').hidden = true; return; }
    box.checked = sw.get();
    if (sw.init) sw.init();
    box.addEventListener('change', () => {
      sw.set(box.checked);
      document.querySelectorAll(`.assistant-switch[data-switch="${box.dataset.switch}"]`).forEach((b) => { b.checked = box.checked; });
    });
  });
  if (picker) {
    picker.addEventListener('change', () => {
      if (!picker.value) return;
      const [workspace, file] = picker.value.split('/');
      const input = el.shadowRoot && el.shadowRoot.querySelector('#text-input');
      picker.value = '';
      if (!input) return;
      const existing = (input.innerText || '').trim();
      const phrase = `Run ${file} in ${workspace}: `;
      input.innerText = existing ? `${existing} ${phrase}` : phrase;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    // Styles do not cross a shadow boundary, so the select takes its own with it.
    const shadowCss = `
      /* The prompt is a card: the text on its own line, and a toolbar under it holding the mode
         selector and the send button — the shape ai_agent_modes uses. deep-chat lays its input out
         in one row, so the row is allowed to wrap and the text box is given the whole first line. */
      #input {
        box-sizing: border-box;
        max-width: 100%;
        flex-wrap: wrap;
        align-items: center;
        row-gap: 8px;
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 8px 10px;
        background-color: var(--surface-input);
      }
      #text-input-container { flex: 1 1 100%; }
      #text-input {
        border: none !important;
        box-shadow: none !important;
        background: transparent !important;
        padding: 4px 2px !important;
      }
      /* deep-chat anchors its buttons absolutely inside zero-size containers, which floats them
         over the text area. In a toolbar they have to take part in the row, so the containers get
         a size and the buttons stop being positioned. */
      .input-button-container {
        order: 2;
        position: static;
        width: auto;
        height: auto;
        display: flex;
        align-items: center;
      }
      .input-button-container > * { position: static !important; }
      .input-button { position: static !important; margin: 0 !important; }
      /* The icons are laid out by deep-chat with their own offsets — the microphone sat 14px down
         and 2px outside its button. Centring them means clearing that, not just centring the box
         that holds them. */
      .input-button svg {
        position: static !important;
        margin: 0 !important;
        inset: auto !important;
        transform: none !important;
        display: block !important;
        flex: none !important;
      }

      /* The send button is the assistant's own colour, the brand gradient its header and your messages
         carry, in a square sized to the selector beside it so the row reads as one control. Every colour in
         this block is a token: a custom property inherits into the shadow root, so both halves follow the
         theme. It used to be UIKit blue, resting on a fixed pale grey that stayed light after dark. */
      .input-button.inside-end {
        width: 34px;
        height: 34px;
        box-sizing: border-box;
        padding: 0 !important;
        border-radius: 8px;
        background: var(--brand-grad) !important;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      /* deep-chat tints its icons with an inline filter, so the icon colour has to be forced the
         same way the background was. On the blue square the arrow is white. */
      .input-button.inside-end svg { width: 17px !important; height: 17px !important; filter: brightness(0) invert(1) !important; }
      .input-button.inside-end:hover { filter: brightness(1.08); }
      /* Disabled is the resting state — there is nothing to send until something is typed — so it reads
         as the same button, not yet ready: the gradient at half strength, the arrow still white. */
      .input-button.inside-end.disabled-button { opacity: .5; }
      .input-button.inside-end.disabled-button:hover { filter: none; }

      /* The microphone is a button too, so it gets the same square as the send button rather than
         sitting next to it as a bare icon. */
      .input-button.outside-end {
        width: 34px;
        height: 34px;
        box-sizing: border-box;
        padding: 0 !important;
        margin-left: 6px !important;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: var(--brand-grad) !important;
      }
      /* The microphone is a filled icon, so it is coloured rather than filtered — the same ink the
         rest of the interface uses, not deep-chat's green tint. */
      .input-button.outside-end svg { width: 17px !important; height: 17px !important; filter: none !important; }
      .input-button.outside-end svg, .input-button.outside-end svg * { fill: var(--text-inverse) !important; }
      .input-button.outside-end:hover { filter: brightness(1.08); }
      /* While it is listening it is the active control in the row, so it says so. */
      .input-button.outside-end.active-button { background: var(--danger) !important; }

      .command-picker {
        order: 2;
        box-sizing: border-box;
        /* A select is as wide as its longest option unless it is told otherwise — 563px of one
           here, in a 358px sidebar. Zero basis with min-width:0 makes it take the space that is
           left instead of the space it wants. */
        flex: 1 1 0;
        width: 0;
        min-width: 0;
        height: 34px;
        font-size: 14px;
        line-height: 1;
        padding: 0 28px 0 10px;
        margin: 0 8px 0 0;
        border: 1px solid var(--line);
        border-radius: 8px;
        background-color: var(--surface-input);
        color: var(--text-default);
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23555' d='M4 6l4 4 4-4z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
        background-size: 14px;
      }
      .command-picker:focus { outline: none; border-color: var(--link); box-shadow: 0 0 0 2px var(--focus-ring); }
    `;

    // The toolbar is built after the component upgrades, so wait for the send button rather than
    // assuming it is there; give up quietly and leave the select where it is if it never appears.
    let tries = 0;
    const place = () => {
      const sr = el.shadowRoot;
      const submit = sr && sr.querySelector('.input-button.inside-end, .input-button.outside-end');
      if (!submit) {
        // No give-up: deep-chat can take longer than any fixed budget on a busy
        // machine, and a silent stop is exactly "sometimes the prompt mode is
        // missing". Poll fast for the first six seconds, then slowly forever —
        // the picker stays visible in its own row until the move happens.
        tries += 1;
        return setTimeout(place, tries < 60 ? 100 : 1000);
      }
      const style = document.createElement('style');
      style.textContent = shadowCss;
      sr.appendChild(style);
      // Into the input row itself, not the small container the button sits in: the selector is
      // sized against the row's free space, and a button container has none to give.
      const buttonBox = submit.closest('.input-button-container') || submit.parentElement;
      buttonBox.parentElement.insertBefore(picker, buttonBox);
      const row = document.querySelector('.chat-tools');
      if (row) row.remove();

      // "@" and "/" in the composer, scoped to the page's own workspace.
      //
      // deep-chat's input is a contenteditable/textarea inside this shadow root, so the
      // suggester has to be handed the element directly — there is no `data-suggest`
      // attribute to find from the document, and querySelectorAll does not cross a
      // shadow boundary. The endpoint carries the workspace (and project, where the page
      // has one) so a project's own .claude/ items outrank the global ones, exactly as a
      // session started in that folder would resolve them.
      const suggestInput = sr.querySelector('#text-input, textarea, [contenteditable="true"]');
      if (suggestInput && window.wsSuggest) {
        const scope = document.body.dataset.suggestScope || '';
        window.wsSuggest.attachSuggest(suggestInput, `/fragments/ai-suggest${scope}`);
      }

      // deep-chat re-renders its shadow DOM after applying async config, which
      // silently deletes foreign nodes — the picker survived only when that
      // re-render happened to run first. The JS reference outlives the detach,
      // so a watchdog puts the same node (and its style) back whenever it is
      // dropped, forever — a re-render can happen again on theme changes.
      setInterval(() => {
        if (picker.isConnected) return;
        const sub2 = sr.querySelector('.input-button.inside-end, .input-button.outside-end');
        if (!sub2) return;
        if (!sr.contains(style)) sr.appendChild(style);
        const box2 = sub2.closest('.input-button-container') || sub2.parentElement;
        box2.parentElement.insertBefore(picker, box2);
      }, 1000);
      // No dark copy of these styles, and nothing mirroring the theme in: every colour above is a token, and a
      // custom property set on <html> inherits into the shadow root, so the toggle reaches it on its own.
    };
    place();
  }
  el.errorMessages = { displayServiceErrorMessages: true };
})();

