/* Tiny progressive-enhancement layer on top of HTMX (no frameworks, no modals). */

// Two-step arm/confirm for destructive Remove buttons: first click arms the
// button (no browser confirm() dialog), second click within 5s fires the
// HTMX request via the custom 'confirmed-remove' trigger.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.arm-step');
  if (!btn) return;
  if (btn.dataset.armed !== '1') {
    e.preventDefault();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = '⚠️ Sure?';
    btn.classList.add('arm');
    setTimeout(() => {
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.label || '🗑️ Remove';
      btn.classList.remove('arm');
    }, 5000);
    return;
  }
  btn.dataset.armed = '0';
  btn.textContent = btn.dataset.label || '🗑️ Remove';
  btn.classList.remove('arm');
  window.htmx && window.htmx.trigger(btn, 'confirmed-remove');
});

// Voice input: mic button uses the browser's Web Speech API to dictate into
// the chat input. Hidden automatically where the API isn't supported.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

document.addEventListener('DOMContentLoaded', () => {
  if (!SpeechRecognition) {
    document.querySelectorAll('.mic-btn').forEach((b) => { b.hidden = true; });
  }
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('.mic-btn');
  if (!btn || !SpeechRecognition) return;
  const input = btn.closest('form').querySelector('input[name="message"]');
  const rec = new SpeechRecognition();
  rec.lang = document.documentElement.lang || 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  btn.classList.add('listening');
  rec.onresult = (ev) => {
    input.value = ev.results[0][0].transcript;
    input.focus();
  };
  rec.onerror = () => { /* mic denied or no speech — just stop listening */ };
  rec.onend = () => btn.classList.remove('listening');
  rec.start();
});

// Interface directives from the Workspace AI Assistant (HX-Trigger events):
// after the agent creates/starts/launches something, it can steer the page —
// open the new site in a tab and/or navigate to the relevant workspace page.
document.body.addEventListener('assistant-directive', (e) => {
  const d = e.detail || {};
  if (d.open) window.open(d.open, '_blank');
  if (d.navigate) setTimeout(() => { location.href = d.navigate; }, 900);
});

// Global "system is working" indicator: count in-flight HTMX requests and
// toggle html.htmx-busy, which shows the top progress bar + Working… pill.
let activeRequests = 0;
const isJobPoll = (e) => e.detail?.elt?.id?.startsWith('job-');
document.addEventListener('htmx:beforeRequest', (e) => {
  if (isJobPoll(e)) return; // 1s job polls would make the bar flicker forever
  activeRequests += 1;
  document.documentElement.classList.add('htmx-busy');
});
const requestDone = (e) => {
  if (isJobPoll(e)) return;
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) document.documentElement.classList.remove('htmx-busy');
};
document.addEventListener('htmx:afterRequest', requestDone);
document.addEventListener('htmx:sendError', requestDone);
document.addEventListener('htmx:responseError', requestDone);

// Keep live terminal boxes scrolled to the newest output line.
document.addEventListener('htmx:afterSwap', (e) => {
  const pres = [];
  if (e.target.classList?.contains('terminal')) pres.push(...e.target.querySelectorAll('.terminal-pre'));
  e.target.querySelectorAll?.('.terminal .terminal-pre').forEach((p) => pres.push(p));
  pres.forEach((p) => { p.scrollTop = p.scrollHeight; });
});

// Keep the chat log scrolled to the latest message after every HTMX swap.
document.addEventListener('htmx:afterSwap', (e) => {
  const log = document.getElementById('chat-log');
  if (log && (e.target === log || log.contains(e.target))) {
    log.scrollTop = log.scrollHeight;
  }
});

// Dark mode toggle (light is the default; choice persists in localStorage).
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-toggle')) return;
  const dark = document.documentElement.classList.toggle('dark');
  try { localStorage.setItem('ws-theme', dark ? 'dark' : 'light'); } catch (_) { /* private mode */ }
});

/* ---------------- the AI assistant, as a deep-chat component ------------ */

// deep-chat is configured with properties rather than attributes: anything that is not a string
// (the connect object, the style maps, the interceptor) cannot survive an attribute.
(function initDeepChat() {
  const el = document.getElementById('ws-deep-chat');
  if (!el || el.dataset.wsReady) return;
  el.dataset.wsReady = '1';

  const context = el.dataset.context || 'home';

  el.connect = {
    url: '/actions/deep-chat',
    method: 'POST',
    additionalBodyProps: { context },
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
    return response;
  };

  // Voice in, using the browser's own speech recognition — no key, no service, and it stops on
  // its own after a pause rather than needing a second click.
  el.speechToText = {
    webSpeech: true,
    displayInterimResults: true,
    stopAfterSubmit: true,
    submitAfterSilence: 2500,
  };

  // The prompt is the main control of this panel, so it is sized like one rather than like a
  // single-line search box: room for a few lines of a real instruction before it scrolls.
  el.textInput = {
    placeholder: { text: context.startsWith('workspace:')
      ? `Ask about ${context.split(':')[1]}… (or use voice)`
      : 'Ask me anything… (or use voice)' },
    styles: {
      container: {
        minHeight: '4.5rem',
        maxHeight: '11rem',
        borderRadius: '0.85rem',
        padding: '0.65rem 0.9rem',
        boxShadow: '0 1px 2px rgba(0,0,0,.06)',
      },
      text: { fontSize: '1rem', lineHeight: '1.45' },
    },
  };

  el.introMessage = { html: `
    <div class="dc-intro">
      <p><strong>Hi!</strong> I can actually do things for you — build, start, back up, and open your
         projects, then take you there.</p>
      <p>\u{1F4A1} <strong>Try these examples:</strong></p>
      <ul>
        <li>"Build a Drupal 11.4 site named d114test"</li>
        <li>"Create a Webship 11 project called demo1 and open it"</li>
        <li>"What's running right now?"</li>
        <li>"Back up every project in dev"</li>
        <li>"Write a doc about demo1 and make a PDF"</li>
      </ul>
    </div>` };

  // A build is minutes of work, so the component must not give up on the request.
  el.requestBodyLimits = { maxMessages: 1 };

  // Prompt mode: picking a command writes it into deep-chat's own input as a sentence and leaves
  // the caret after it. deep-chat keeps its input in an open shadow root, so it is reachable —
  // and writing there rather than submitting keeps the agent in charge of how the command runs.
  const picker = document.querySelector('.chat-tools .command-picker');
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
  }
  el.errorMessages = { displayServiceErrorMessages: true };
})();
