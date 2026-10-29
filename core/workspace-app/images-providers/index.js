/**
 * The image providers, one module each. A provider declares what it can do (`kinds`), its models, sizes and
 * qualities, whether it is usable here (`available`), and the calls for those kinds. The forms and actions
 * read this list, so a new provider is one file added to ORDER.
 */

const ORDER = ['openai', 'gemini', 'xai', 'stability', 'anthropic', 'claude-code'];
const ALL = ORDER.map((f) => require(`./${f}`));

/** Every provider, or those that can do one kind (generate, edit, svg). */
function list(kind) {
  return kind ? ALL.filter((p) => p.kinds.includes(kind)) : ALL.slice();
}

/** A provider by id, or null. */
function get(id) {
  return ALL.find((p) => p.id === id) || null;
}

/** The provider a form names for a kind, or the first that can do it. The forms preselect one that is set up. */
function pick(id, kind) {
  const can = list(kind);
  return can.find((p) => p.id === id) || can[0];
}

module.exports = { ORDER, list, get, pick };
