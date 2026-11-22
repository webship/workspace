// What the dashboard's pages put on window, as far as the scripts in src/browser read it.

/** UIkit (vendored), the parts the scripts call. */
interface UIkitApi {
  dropdown(el: Element): { hide(animate?: boolean): void };
}

/** htmx (vendored), the parts the scripts call. */
interface HtmxApi {
  process(el: Element): void;
  ajax(verb: string, url: string, opts: { target: string; swap: string }): unknown;
}

interface Window {
  UIkit?: UIkitApi;
  htmx?: HtmxApi;
  /** The page head's preference store (a cookie on the hub domain, then localStorage). */
  wsPrefSet?: (key: string, value: string) => void;
  /** ui.js: flash the notices that just arrived in `el`. */
  flashResults?: (el: Element) => void;
}

/** The Web Speech API's recogniser, as far as the field microphones use it (not in TypeScript's DOM library). */
interface SpeechRecognitionAlternativeLike { transcript: string }
interface SpeechRecognitionResultLike { readonly isFinal: boolean; readonly [index: number]: SpeechRecognitionAlternativeLike }
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike extends Event { readonly error: string }
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** The speech settings the server resolves (speech.js) and puts on the page. */
interface WsSpeech {
  /** The field microphones' settings, or false when they are switched off. */
  fieldMic?: { lang?: string; interimResults?: boolean } | false | null;
}

interface Window {
  SpeechRecognition?: SpeechRecognitionCtor;
  webkitSpeechRecognition?: SpeechRecognitionCtor;
  WS_SPEECH?: WsSpeech;
}

/** suggest.js's "@" and "/" suggestions, for ui.js to attach to the assistant's composer. */
interface WsSuggestApi {
  attachSuggest(el: HTMLElement, url: string): void;
  attachAll(root?: ParentNode | null): void;
  tokenAt(value: string, caret: number): { trigger: string; at: number; typed: string } | null;
}

interface Window {
  wsSuggest?: WsSuggestApi;
}
