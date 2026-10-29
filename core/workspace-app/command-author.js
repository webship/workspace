/**
 * What the assistant is told when it writes or changes a `cmd-*.sh`.
 *
 * A workspace command is not a free-form script. It has a fixed shape — locate the tooling from its
 * own path, source the bootstrap, parse the workspace's settings file, declare its arguments through
 * the argparse heredoc, then call one function — and a set of rules that are not negotiable, because
 * breaking them breaks the machine rather than the script: DDEV only, no `$databases` block, no
 * masked failures. An agent that has not been told these writes plausible bash that this workspace
 * cannot use.
 *
 * So the prompt carries the conventions, and it points at the real files rather than describing
 * them: the surest way to write a command like the others is to read the others. The agent is given
 * read tools ONLY — it never writes the file itself. Its answer is captured, checked with `bash -n`,
 * and only then does it become a command.
 *
 * One module, two callers: creating a command with a purpose, and asking for a change to one that
 * exists. They share every rule; only the last paragraph differs.
 */

const path = require('path');

const { ROOT } = require('./workspaces');

// The conventions, in the order they appear in a real command. Written as instructions rather than
// as prose about instructions, because this text is read by an agent and not by a person.
function conventions(workspace) {
  return `THE SHAPE OF A WORKSPACE COMMAND — follow it exactly:

1. \`#!/usr/bin/env bash\` and, for a builder, a \`# workspace-name: <Human Name>\` header on line 3.
   The smoke test at core/scripts/tests/cmd-smoke-test.sh enforces the header on cmd-*-project.sh.
2. The bootstrap, verbatim, so a fresh clone needs no setup and no environment variable:
     WORKSPACE_SCRIPTS="\${WORKSPACE_SCRIPTS:-$(cd "$(dirname "\${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
     source \${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;
3. \`eval $(parse_yaml \${WORKSPACE_CONFIG}/workspace.${workspace}.settings.yml);\` — this is where
   \`doc_name\` comes from, and every function below uses it.
4. \`ARGPARSE_DESCRIPTION="…"\` then \`source \${WORKSPACE_SCRIPTS}/args/arg-<name>.sh || exit 1 ;\`
5. \`shift $#;\` then ONE call to the function that does the work.

The logic goes in \`core/scripts/functions/fun-<name>.sh\`, sourced from
core/scripts/bootstrap-functions.sh. A cmd-*.sh that contains its own logic is the wrong shape: the
command is the entry point, the function is the program.

ARGUMENTS are declared in an argparse heredoc in core/scripts/args/arg-<name>.sh. Optional string
flags default to the string \`_none_\` and are tested \`[ ! "\${FLAG}" == '_none_' ]\`. Booleans use
\`action='store_true'\` and arrive as \`yes\` or empty. Do NOT use \`nargs='+'\`: this argparse hands
arrays back as a scalar and the extra values are lost silently.

HARD RULES — these are not style:
  * DDEV only. \`ddev composer\`, \`ddev drush\`, \`ddev exec\`, \`ddev export-db\`. Never raw composer,
    drush, npm or mysql on the host.
  * Never write a \`$databases\` block into settings.php — DDEV's settings.ddev.php owns it.
  * \`ddev start\` accepts \`-y\`; \`ddev stop\` does NOT.
  * Never mask a failure with \`|| true\` on a command whose result matters, and never \`rm -rf\` a
    path built from an unvalidated argument.
  * Anything the dashboard runs has no one to answer a prompt, so never wait for input.
  * A command that CREATES something for its own checking removes it again, or reports it and stops —
    never leaves a scratch project behind. Remove one with cmd-tools-remove.sh <project>, or
    ddev delete -y -O inside it; never rm -rf. The folder is not the project: deleting it alone
    strands the DDEV registry entry, the database volume, the snapshots volume and the built images.

READ THESE FIRST with your tools — they are the pattern, and copying it is the point:
  ${path.join(ROOT, workspace)}/cmd-*.sh                    (the commands this workspace already has)
  ${path.join(ROOT, 'core', 'scripts', 'functions')}/       (every fun-*.sh — the functions that already exist)
  ${path.join(ROOT, 'core', 'scripts', 'args')}/            (every arg-*.sh — the argparse blocks that already exist)
  ${path.join(ROOT, 'core', 'scripts', 'bootstrap.sh')}               (what is exported for you)

REUSE BEFORE INVENTING. List both directories and read what is close to the task: the best command
is usually ONE call to a function somebody already wrote, behind an arg file that already fits
(arg-distribution, arg-webship-site-template, arg-checks, arg-testing …). Write new logic inline
only when no existing function covers it — and then still declare the arguments through an existing
arg file when one matches, so the same flags mean the same things across the workspace.`;
}

/** Writing a new command's body into the scaffold that already exists. */
function commandAuthorPrompt({ workspace, file, purpose, scaffoldPath }) {
  return `You are writing a command for the Webship Workspace, a DDEV-only harness rooted at ${ROOT}.

The file ${scaffoldPath} has just been scaffolded and already carries the correct bootstrap chain.
Read it first. Rewrite it so it does what is asked below, keeping every line of the bootstrap exactly
as it is.

WHAT IT SHOULD DO:
${purpose}

${conventions(workspace)}

Also state, in a comment block at the top of the file, what this command is for and what it will NOT
do — the destructive edges it deliberately leaves alone. That comment is the first thing the next
person reads.

If the work needs a new function file or a new arg file, say so in a comment at the point it would be
called, naming the exact path — you cannot create it, and a command that calls a function nobody
wrote fails loudly on the first run, which is better than a command that silently does half of it.

Output ONLY the complete contents of ${file}. No commentary, no code fences, no explanation.`;
}

/** Changing a command that already exists, to an instruction. */
function commandEditPrompt({ workspace, file, instruction, fullPath }) {
  return `You are changing a command in the Webship Workspace, a DDEV-only harness rooted at ${ROOT}.

The command is ${fullPath}. Read it first, and read the commands beside it.

WHAT TO CHANGE:
${instruction}

Change only what that asks for. Everything else — the bootstrap chain, the argparse source line, the
comments explaining decisions somebody already made — stays exactly as it is. If the instruction
cannot be carried out without breaking one of the rules below, do not carry it out: leave the file as
it is and put a single comment at the top saying which rule stopped you.

${conventions(workspace)}

Output ONLY the complete new contents of ${file}. No commentary, no code fences, no explanation.`;
}

module.exports = { commandAuthorPrompt, commandEditPrompt, conventions };
