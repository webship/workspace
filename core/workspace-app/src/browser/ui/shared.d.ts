// The names a ui.js part still in .js declares and a .ts part uses: the parts share one script's scope in ui.js,
// so a .ts part calls them by name. Each goes from here when the part that declares it is typed.

/** 01-core: the page head's preference store, or its guard (a cookie on the hub domain, then localStorage). */
declare const wsPref: (name: string, fallback: string) => string;
declare const wsPrefSet: (name: string, value: string) => void;

/** 01-core: the element an htmx swap put in the page, from its event. */
declare function swappedEl(e: Event): Element | null;
