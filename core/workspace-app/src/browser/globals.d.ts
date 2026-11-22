// What the dashboard's pages put on window, as far as the scripts in src/browser read it.

/** UIkit (vendored), the parts the scripts call. */
interface UIkitApi {
  dropdown(el: Element): { hide(animate?: boolean): void };
}

/** htmx (vendored), the parts the scripts call. */
interface HtmxApi {
  process(el: Element): void;
}

interface Window {
  UIkit?: UIkitApi;
  htmx?: HtmxApi;
  /** ui.js: flash the notices that just arrived in `el`. */
  flashResults?: (el: Element) => void;
}
