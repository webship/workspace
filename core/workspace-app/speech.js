/**
 * The assistant panel's voice settings, resolved into the objects deep-chat expects.
 *
 * The page used to be handed a flat bag of values and rebuild deep-chat's `speechToText` /
 * `textToSpeech` objects itself, in a browser file nothing can require. That put the one part with
 * real rules — which keys may be absent, which must never be empty — where it could only be checked
 * by reading the source. The rules live here instead, the server sends the finished objects, and the
 * page assigns them.
 *
 * The rules are not decoration. deep-chat silently ignores a key it does not recognise and silently
 * ACCEPTS one it does, so both kinds of mistake are invisible at runtime:
 *
 *   - `commands` built with empty strings arms voice commands nobody asked for. A blank `submit`
 *     phrase does not mean "no command"; it means a command that can trigger on almost anything.
 *   - `commands.settings.substrings` defaults to TRUE in deep-chat, so "submit the form" fires a
 *     `submit` command mid-sentence. It has to be turned off deliberately.
 *   - `webSpeech: true` accepts the browser's language. A recogniser left on the wrong one does not
 *     fail — it returns confident nonsense — so pinning it is the one setting that changes whether
 *     dictation works at all in a second language.
 *
 * Azure is the other backend deep-chat supports and is deliberately not offered: it needs a
 * subscription key and sends the audio to a third party. Everything here stays on the machine, for
 * the same reason the RAG index is local.
 */

'use strict';

/** Defaults, in one place, so the page and the resolver cannot disagree about them. */
const DEFAULTS = {
  // What the assistant is CALLED, and what its composer says when the box is empty.
  name: 'AI Assistant',
  placeholder: '',
  voiceInput: true,
  voiceOutput: true,
  submitAfterSilence: 2500,
  speechRate: 1,
  speechPitch: 1,
  speechVolume: 1,
  interimResults: true,
  stopAfterSubmit: true,
  speechLanguage: 'en-US',
  voiceName: '',
  // The assistant's avatar, shown from the robot icon in its panel's header: the one it starts as, one
  // of `avatars`, or `none` for no avatar and no icon.
  avatar: 'druplicon',
  // The avatars that can be picked in the panel (assistant-cast.js finds each in the avatars workspace).
  avatars: ['druplicon'],
  // Where the assistant keeps what the team teaches it, relative to the workspace root.
  memory: 'core/workspace-app/.memory',
  // The Claude Code agent the assistant runs as; `none` runs it without one.
  agent: 'webship-workspace',
};
const AVATARS = ['druplicon', 'none'];

/**
 * The Workspace's default language, settings.yml `language:` (one of LANGUAGES, without `auto`): the
 * language the assistant answers in, listens for and speaks. en-US when it is unset or not one we know.
 */
function workspaceLanguage(settings = {}) {
  const v = String((settings && settings.language) || '').trim();
  const known = LANGUAGES.find(([code]) => code !== 'auto' && code.toLowerCase() === v.toLowerCase());
  return known ? known[0] : DEFAULTS.speechLanguage;
}
const languageName = (code) => (LANGUAGES.find(([c]) => c === code) || [code, code])[1];

// The names in `assistant.avatars:`, each a plain machine name; the shipped list when there are none.
const avatarList = (v) => {
  const names = (Array.isArray(v) ? v : []).map((x) => String(x || '').trim().toLowerCase())
    .filter((x, i, all) => /^[a-z0-9][a-z0-9_-]{0,62}$/.test(x) && x !== 'none' && all.indexOf(x) === i);
  return names.length ? names : DEFAULTS.avatars;
};
const bool = (v, d) => (v === undefined || v === null ? d : v !== false && v !== 'false');
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d) => (typeof v === 'string' && v.trim() ? v.trim() : d);

/**
 * "Not set", spelled as a word.
 *
 * An empty value in settings.yml (`speech_language: ""`) is unreadable — it looks like a setting
 * somebody forgot to finish rather than one deliberately left to the browser, and it renders in the
 * settings form as a blank box with no clue what belongs there. So the file says `auto`, `default` or
 * `off`, and they all resolve to the same nothing here.
 */
// `false` and `no` belong here as well as the obvious words: parse_yaml hands values back as
// STRINGS, so `command_stop: false` arrives as "false" — which without this is a phrase, and the
// microphone would sit there listening for someone to say the word "false".
const UNSET = new Set(['auto', 'default', 'off', 'none', 'browser', 'false', 'no', '0', '']);
const optional = (v) => {
  const t = str(v, '');
  return UNSET.has(t.toLowerCase()) ? '' : t;
};

/**
 * The recogniser languages offered in the settings form.
 *
 * A short, deliberate list rather than the full BCP-47 registry: the browser accepts any tag, and a
 * dropdown of nine hundred is worse than a text box. These are the ones this workspace is actually
 * used in, with the Gulf and Levant Arabic variants — plus an empty
 * first entry, because "follow the browser" is the right answer for most people and must stay
 * reachable once the field is a select.
 *
 * A value that is not on the list is kept and shown as unknown rather than silently corrected: the
 * settings file is the source of truth, and a form that quietly rewrites it is worse than one that
 * admits it does not recognise a value.
 */
const LANGUAGES = [
  ['auto', 'Follow the browser'],
  ['en-US', 'English (United States)'],
  ['en-GB', 'English (United Kingdom)'],
  ['ar-JO', 'Arabic (Jordan)'],
  ['ar-SA', 'Arabic (Saudi Arabia)'],
  ['ar-AE', 'Arabic (United Arab Emirates)'],
  ['ar-EG', 'Arabic (Egypt)'],
  ['fr-FR', 'French (France)'],
  ['de-DE', 'German (Germany)'],
  ['es-ES', 'Spanish (Spain)'],
  ['tr-TR', 'Turkish (Türkiye)'],
];

/**
 * What the plain field microphones need — the small mic beside every text input, which is a separate
 * implementation from deep-chat's and predates it.
 *
 * It has to be a separate shape because those mics are raw `SpeechRecognition`, not deep-chat: they
 * take a `lang` string, not a `webSpeech` object. What matters is that both come from THIS module,
 * so `speech_language` reaches all of them. Before this, 36 field mics on the settings page alone
 * were pinned to `document.documentElement.lang` and ignored the setting entirely — which is the
 * confident-nonsense failure again, on most of the microphones in the app.
 */
function fieldMicConfig(cfg) {
  if (!cfg.voiceInput) return false;
  return {
    // Empty means "let the browser decide", which is what SpeechRecognition does with an unset lang.
    lang: cfg.speechLanguage || '',
    interimResults: cfg.interimResults !== false,
  };
}

/**
 * What a voice command setting means.
 *
 *   true / "true"   listen for the command's own word ("stop", "submit", …)
 *   false / off     no command — and `off` must keep working, because that is what shipped
 *   "any phrase"    listen for that instead, which is the only way to have one in another language
 */
function commandPhrase(value, word) {
  if (value === true || value === 'true' || value === 'yes' || value === 'on') return word;
  return optional(value);
}
/**
 * What the assistant is called here, and what its composer says when empty.
 *
 * Two levels, because one dashboard runs many workspaces: `assistant:` in `settings.yml` is the
 * default — the home page and every page that belongs to no workspace — and `assistant:` in
 * `workspace.<name>.settings.yml` overrides it for that workspace's page and its backups page.
 * A folder whose assistant answers for Penpot instances can say so; the rest inherit.
 *
 * **One rule, applied at each level: blank, or one of the unset words, means "not set here".** A
 * workspace that says nothing takes the global value; a global that says nothing takes the shipped
 * default. It is the same merge `presentation:` already does, and it is what lets every workspace
 * file ship the keys with `default` in them — visible and editable in the settings form, without
 * twenty-four copies of the name quietly pinning it against a change made in one place.
 *
 * What that rule costs, stated rather than discovered: a workspace cannot silence a placeholder the
 * global has set, because "say nothing" is how it inherits. Set the placeholder per workspace
 * instead of globally if one of them needs to be silent.
 */
function assistantIdentity(settings = {}, wsSettings = null) {
  const global = (settings && settings.assistant) || {};
  const own = (wsSettings && wsSettings.assistant) || {};
  const level = (key) => optional(own[key]) || optional(global[key]);
  return {
    name: level('name') || DEFAULTS.name,
    placeholder: level('placeholder') || DEFAULTS.placeholder,
  };
}

/** The `assistant:` block of settings.yml, normalised. */
function assistantSettings(settings = {}) {
  const a = settings.assistant || {};
  return {
    voiceInput: bool(a.voice_input, DEFAULTS.voiceInput),
    voiceOutput: bool(a.voice_output, DEFAULTS.voiceOutput),
    // 0 means "never send for me": deep-chat wants the key absent for that, not zero.
    submitAfterSilence: num(a.submit_after_silence, DEFAULTS.submitAfterSilence),
    speechRate: num(a.speech_rate, DEFAULTS.speechRate),
    speechPitch: num(a.speech_pitch, DEFAULTS.speechPitch),
    speechVolume: num(a.speech_volume, DEFAULTS.speechVolume),
    // en-US ships as the default rather than 'follow the browser': most dictation here is
    // English, and a browser set to something else silently recognised the wrong language.
    // `auto` is still one dropdown entry away for anyone who wants the browser's choice.
    // Unset, it is the Workspace's own language (settings.yml `language:`), so one line sets both.
    speechLanguage: a.speech_language === undefined
      ? workspaceLanguage(settings)
      : optional(a.speech_language),
    voiceName: optional(a.voice_name),
    avatars: avatarList(a.avatars),
    avatar: a.avatar === 'none' ? 'none' : (avatarList(a.avatars).includes(String(a.avatar)) ? String(a.avatar) : avatarList(a.avatars)[0]),
    agent: a.agent === undefined ? DEFAULTS.agent : (/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(a.agent)) && String(a.agent) !== 'none' ? String(a.agent) : ''),
    // A folder inside the workspace tree, never an absolute path or one that climbs out of it.
    memory: typeof a.memory === 'string' && /^[\w.-]+(\/[\w.-]+)*$/.test(a.memory.trim()) && !/(^|\/)\.\.(\/|$)/.test(a.memory) ? a.memory.trim() : DEFAULTS.memory,
    interimResults: bool(a.interim_results, DEFAULTS.interimResults),
    stopAfterSubmit: bool(a.stop_after_submit, DEFAULTS.stopAfterSubmit),
    // A voice command is an on/off choice, so the setting is a checkbox and the phrase is the
    // command's own word: `command_stop: true` listens for "stop". A text box holding the word
    // `off` was the wrong control for the question — it asked people to type a phrase when what
    // they wanted was to turn something on.
    //
    // A STRING is still honoured, so anyone who wants a phrase of their own can write one. That
    // matters for a second language: "stop" is not the word an Arabic speaker will say.
    commands: {
      submit: commandPhrase(a.command_submit, 'submit'),
      stop: commandPhrase(a.command_stop, 'stop'),
      pause: commandPhrase(a.command_pause, 'pause'),
      resume: commandPhrase(a.command_resume, 'resume'),
      removeAllText: commandPhrase(a.command_clear, 'clear'),
    },
  };
}

/**
 * deep-chat's `speechToText`, or `false` to remove the microphone entirely rather than leave a
 * button that does nothing.
 */
function speechToTextConfig(cfg) {
  if (!cfg.voiceInput) return false;

  // Only the commands that were actually given a phrase. An empty phrase is not a disabled command.
  const commands = {};
  for (const [key, phrase] of Object.entries(cfg.commands || {})) {
    if (phrase) commands[key] = phrase;
  }

  return {
    webSpeech: cfg.speechLanguage ? { language: cfg.speechLanguage } : true,
    displayInterimResults: cfg.interimResults !== false,
    stopAfterSubmit: cfg.stopAfterSubmit !== false,
    ...(cfg.submitAfterSilence ? { submitAfterSilence: cfg.submitAfterSilence } : {}),
    // Interim words are a guess the recogniser is still revising, so they are muted; the settled
    // text is ordinary body colour. Tokens, not literals, so both themes follow with no second copy.
    textColor: { interim: 'var(--text-subtle)', final: 'var(--text-default)' },
    // The microphone in the design system rather than deep-chat's stock red, and command mode in the
    // accent so an active listening mode is visible at a glance.
    button: {
      default: { container: { default: { color: 'var(--text-subtle)' } } },
      active: { container: { default: { color: 'var(--danger, #d33)' } } },
      commandMode: { container: { default: { color: 'var(--link)' } } },
    },
    ...(Object.keys(commands).length
      ? { commands: { ...commands, settings: { substrings: false, caseSensitive: false } } }
      : {}),
  };
}

/**
 * deep-chat's `textToSpeech`, or `false`. Its presence IS "read the replies aloud" — there is no
 * separate switch, and `audio.autoPlay` in the docs is about responses carrying an audio file, which
 * this assistant never returns.
 */
function textToSpeechConfig(cfg) {
  if (!cfg.voiceOutput) return false;
  return {
    volume: cfg.speechVolume,
    rate: cfg.speechRate,
    pitch: cfg.speechPitch,
    // A name the browser does not have falls back to its default rather than going silent. The lists
    // differ per browser and per OS, which is why the setting is a plain string and not a menu.
    ...(cfg.voiceName ? { voiceName: cfg.voiceName } : {}),
    // The recogniser's language is the right default for the reply too: ask in Arabic, be answered
    // in an Arabic voice, without setting it twice.
    ...(cfg.speechLanguage ? { lang: cfg.speechLanguage } : {}),
  };
}

/** What the page is handed: the flags it still needs, plus the two finished deep-chat objects. */
function panelConfig(settings = {}, wsSettings = null) {
  const cfg = assistantSettings(settings);
  return {
    ...assistantIdentity(settings, wsSettings),
    voiceInput: cfg.voiceInput,
    speechToText: speechToTextConfig(cfg),
    textToSpeech: textToSpeechConfig(cfg),
    // The narration toggle in the panel header. `voiceOutput` is only where it STARTS (settings.yml's
    // voice_output; a choice made with the toggle is the browser's and wins). `narration` is the voice
    // to use when it is on, always present: textToSpeech above is `false` when the setting is off, and
    // someone who turns the toggle on still has to be spoken to in the voice they configured.
    voiceOutput: cfg.voiceOutput,
    narration: textToSpeechConfig({ ...cfg, voiceOutput: true }),
    fieldMic: fieldMicConfig(cfg),
    avatar: cfg.avatar,
  };
}

module.exports = {
  assistantSettings, assistantIdentity, speechToTextConfig, textToSpeechConfig, fieldMicConfig,
  panelConfig, LANGUAGES, DEFAULTS, UNSET, AVATARS, workspaceLanguage, languageName,
};
