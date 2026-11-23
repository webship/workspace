/**
 * /tmp/.docksal is Docksal's own: its `fin` keeps a folder per project there for the project's ssh-agent socket. Run
 * from a folder under /tmp, fin took /tmp for a project (the first folder above with a .docksal/ that is not the home
 * folder) and wrote that project's docksal.env and docksal.yml into /tmp/.docksal, so every test sandbox under /tmp
 * became part of "the Docksal project /tmp" (#772). A test file that runs fin, or a command that does, notes what is
 * there when it starts and checks at its end that it is as it was.
 */
const fs = require('fs');
const path = require('path');

const DOCKSAL_TMP = path.join(path.sep, 'tmp', '.docksal');

/** What a project of /tmp leaves in /tmp/.docksal, each file with its size and time: docksal.env and docksal.yml. */
function projectOfTmp() {
  return ['docksal.env', 'docksal.yml'].filter((f) => fs.existsSync(path.join(DOCKSAL_TMP, f)))
    .map((f) => { const st = fs.statSync(path.join(DOCKSAL_TMP, f)); return `${f} ${st.size} ${st.mtimeMs}`; });
}

module.exports = { DOCKSAL_TMP, projectOfTmp };
