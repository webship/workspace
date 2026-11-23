// What the dashboard's pages put on window, as far as the scripts in src/browser read it.

/** UIkit (vendored), the parts the scripts call. */
interface UIkitApi {
  dropdown(el: Element): { hide(animate?: boolean): void };
  modal(el: Element | string): { show(): Promise<unknown>; hide(): Promise<unknown> };
}

/** htmx (vendored), the parts the scripts call. */
interface HtmxApi {
  process(el: Element): void;
  ajax(verb: string, url: string, opts: { target: string; swap: string; values?: Record<string, unknown> }): Promise<unknown>;
  trigger(el: Element, name: string, detail?: unknown): void;
  /** The same request, swapped into an element the caller holds rather than one a selector names (the tab modals). */
  ajax(verb: string, url: string, opts: { target: Element; swap: string }): Promise<unknown>;
}
/** htmx, as the vendored script puts it on the page. */
declare const htmx: HtmxApi;

interface Window {
  UIkit?: UIkitApi;
  htmx?: HtmxApi;
  /** The page head's preference store (a cookie on the hub domain, then localStorage). */
  wsPrefSet?: (key: string, value: string) => void;
  /** ui.js: flash the notices that just arrived in `el`. */
  flashResults?: (el: Element) => void;
  /** ui.js (10-rail-arranged): Commands → Rail's entries carry the group they are in; the form calls it. */
  navSyncGroups: () => void;
  /** ui.js (16-new-screen-form): the New screen form's kind, its session name and a prompt template. */
  screenKindChanged: (form: HTMLFormElement | null) => void;
  screenNameFollowsTarget: (form: HTMLFormElement | null) => void;
  screenPromptTemplate: (select: HTMLSelectElement) => void;
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

/** The speech settings the server resolves (speech.mts) and puts on the page. */
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

/** xterm.js and its addons (vendored under /vendor/xterm/), as far as terminal.ts uses them. */
interface XtermTerminal {
  cols: number;
  rows: number;
  options: { theme?: Record<string, string>; fontSize?: number; fontFamily?: string };
  unicode: { activeVersion: string };
  open(el: HTMLElement): void;
  write(data: string | Uint8Array): void;
  focus(): void;
  dispose(): void;
  loadAddon(addon: object): void;
  onData(listener: (data: string) => void): unknown;
  onBinary(listener: (data: string) => void): unknown;
  attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void;
  /** Private, read for the size of a cell where the renderer has measured one. */
  _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } };
}
interface XtermFitAddon { fit(): void }
interface Window {
  /** xterm.js, once terminal.ts has loaded it (loadXterm). */
  Terminal: new (options: Record<string, unknown>) => XtermTerminal;
  FitAddon: { FitAddon: new () => XtermFitAddon };
  Unicode11Addon?: { Unicode11Addon: new () => object };
  WebLinksAddon?: { WebLinksAddon: new (handler: (event: MouseEvent, uri: string) => void) => object };
  /** terminal.ts: the loading of xterm.js, shared by the windows that ask for it at once. */
  __xtermLoading?: Promise<unknown> | null;
  /** Ace, the code editor (vendored under /vendor/ace/), once a ui.js part has loaded it. */
  ace?: AceApi;
  /** terminal.ts: open a screen session's terminal window. */
  openTerminal: (session: string) => void;
}

/** A timer that is none yet: the browsers' clearTimeout and clearInterval take null (it converts to 0, no timer). */
declare function clearTimeout(id: number | null | undefined): void;
declare function clearInterval(id: number | null | undefined): void;

/** Ace (vendored under /vendor/ace/), as far as the editors use it. */
interface AceSession {
  setMode(mode: string): void; setValue(text: string): void; getValue(): string; getLine(row: number): string;
  setUseSoftTabs(on: boolean): void; setTabSize(size: number): void; on(event: 'change', listener: () => void): void;
}
interface AceEditor {
  session: AceSession; $options?: Record<string, unknown>;
  setTheme(theme: string): void; setShowPrintMargin(on: boolean): void; setOption(name: string, value: unknown): void;
  setOptions(options: Record<string, unknown>): void; commands: { addCommand(command: object): void };
  on(event: 'paste', listener: (ev: { text: string }) => void): void; resize(): void;
}
interface AceCompleter {
  identifierRegexps: RegExp[];
  getCompletions(editor: AceEditor, session: AceSession, pos: { row: number; column: number }, prefix: string, callback: (error: null, list: object[]) => void): void;
}
interface AceApi {
  edit(host: HTMLElement): AceEditor;
  require(name: string): { addCompleter(completer: AceCompleter): void } | undefined;
  config: { set(name: string, value: string): void; setModuleUrl(module: string, url: string): void };
}
