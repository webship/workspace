/**
 * What a name is allowed to be.
 *
 * Every action that takes a project or a script name checks it against these before touching the
 * filesystem — so a crafted name is refused at the door rather than resolved and then found to be
 * outside the tree.
 */

const NAME_RE = /^[a-zA-Z0-9_\-]+$/;
// A file item — a doc, a worklog, an agent — is named after its file, and those
// names carry dots: a version in a report name, a time in a dated worklog. The
// project rule above refuses them, which made Edit answer 400 on real files. This
// one allows a dot inside the name while still refusing traversal: nothing may
// start with a dot, and ".." never appears.
const ITEM_NAME_RE = /^(?!\.)(?!.*\.\.)[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SCRIPT_RE = /^cmd-[a-zA-Z0-9_.-]+\.sh$/;

module.exports = { NAME_RE, ITEM_NAME_RE, SCRIPT_RE };
