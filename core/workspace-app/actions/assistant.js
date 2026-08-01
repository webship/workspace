/**
 * The AI assistant's turn: the HTMX chat pane.
 *
 * One module per area of the dashboard, each exporting the handlers it owns keyed by the path
 * that reaches them. server.js merges the maps and dispatches; nothing here knows about routing,
 * and adding an action is adding an entry rather than another branch in a 650-line function.
 *
 * Every handler takes the same context: the parsed form, the response, a `send` that writes an
 * HTML fragment, and the workspace the request named.
 */


const { esc } = require('../html');
const { assistantReply } = require('../assistant');
const handlers = {
  '/actions/chat': async ({ form, res, send, workspace, req, pathname }) => {
    const message = String(form.message || '').trim();
    if (!message) return send('<div class="msg error">Empty message.</div>', 400);
    const { replyHtml, directive } = await assistantReply(message, String(form.context || ''));

    const triggers = { 'refresh-projects': directive.refresh ? {} : undefined, 'assistant-directive': (directive.navigate || directive.open) ? directive : undefined };
    const activeTriggers = Object.fromEntries(Object.entries(triggers).filter(([, v]) => v !== undefined));
    if (Object.keys(activeTriggers).length) res.setHeader('HX-Trigger', JSON.stringify(activeTriggers));

    return send(`<div class="msg user">${esc(message)}</div><div class="msg assistant">${replyHtml}</div>`);
  },
};

module.exports = handlers;
