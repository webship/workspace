/**
 * The one escaper every fragment goes through.
 *
 * Its own module because everything that renders HTML needs it and nothing else in this file is a
 * dependency of it — so a module can import the escaper without importing the server.
 */

const ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
