/**
 * The one escaper every fragment goes through.
 *
 * Its own module because everything that renders HTML needs it and nothing else in this file is a
 * dependency of it — so a module can import the escaper without importing the server.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

module.exports = { esc };
