/**
 * Writing the order of the builders in Build a new project.
 *
 * One form carries the whole arrangement, and every write carries the file's mtime and is refused with
 * 409 when it changed since — the same rule as every other writer here, and it matters more than usual
 * on this one: two people arranging the same list would otherwise silently keep whichever saved last.
 *
 * **Only what was moved is written.** The form posts every row, but a list that recorded all of them
 * would freeze the order of commands nobody has an opinion about: one added next month would then land
 * at the bottom rather than in its shipped place, and the file would assert decisions nobody made. So
 * what is written is the SHORTEST list that reproduces what you see — see `minimalOrder`.
 */

const order = require('../build-order');
const page = require('../build-order-page');
const { loadWorkspaces } = require('../workspaces');

const ok = (msg) => `<div class="msg assistant">✅ ${msg}</div>`;
const bad = (msg) => `<div class="msg error">${msg}</div>`;

const asArray = (v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]));

/** 'global', or a workspace that really exists; anything else is refused rather than written. */
function scopeOf(form) {
  const want = String(form.scope || 'global');
  if (want === 'global') return 'global';
  return loadWorkspaces()[want] ? want : null;
}

function editor(send, form, message, status = 200) {
  const scope = scopeOf(form) || 'global';
  return send(page.editorHtml(scope, message), status);
}

async function build_order_save({ form, send }) {
  const scope = scopeOf(form);
  if (!scope) return send(bad('No such workspace.'), 400);

  // One form, two lists. A kind that was not posted is left ALONE rather than emptied: a page that
  // showed no tools must not be able to erase the tool order somebody set on another tab.
  const posted = {
    builders: [...new Set(asArray(form.builder).map(String).filter(order.isBuilder))],
    tools: [...new Set(asArray(form.tool).map(String).filter(order.isTool))],
  };
  if (!posted.builders.length && !posted.tools.length) {
    return editor(send, form, bad('Nothing to save: no commands were posted.'), 400);
  }

  const { raw, mtime } = order.rawOrder();
  if (String(form.mtime || '') !== String(mtime)) {
    return editor(send, form,
      bad('The command order changed somewhere else while this was open — nothing was written. This is how it is now.'), 409);
  }

  const kept = {};
  let placed = 0;
  for (const kind of order.KINDS) {
    if (!posted[kind].length) continue;            // not posted: withScope keeps what is on disk
    kept[kind] = order.minimalOrder(posted[kind], scope, kind);
    placed += kept[kind].length;
  }
  order.saveOrder(order.withScope(raw, scope, kept));
  return editor(send, form, ok(placed
    ? `Command order saved — ${placed} placed by this list, the rest left where they were. It applies on the next page you open.`
    : 'Command order saved. Nothing here differs from the shipped order, so this scope names nothing — which is what makes a command added later still arrive in the right place.'));
}

async function build_order_reset({ form, send }) {
  const scope = scopeOf(form);
  if (!scope) return send(bad('No such workspace.'), 400);
  const { raw } = order.rawOrder();
  order.saveOrder(order.withScope(raw, scope, Object.fromEntries(order.KINDS.map((k) => [k, []]))));
  return editor(send, form, ok('Back to the shipped order.'));
}

module.exports = {
  '/actions/build-order-save': build_order_save,
  '/actions/build-order-reset': build_order_reset,
};
