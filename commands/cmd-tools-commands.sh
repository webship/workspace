#!/usr/bin/env bash

# workspace-name: Workspace Commands

# One place to see and manage every cmd-*.sh in the tree: list them, scaffold a
# new one, clone one (retargeted at another workspace if asked), pull one down
# from the tooling repository, diff against the repository, and hand one to the AI
# agent to file the issue and open the PR.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# commands/ is a Settings section, not a registered workspace, so it has no
# workspace.<name>.settings.yml to read — doc_name is just the folder, and it is what
# the mirror checkout and the backup path are built from.
doc_name="commands";

ARGPARSE_DESCRIPTION="List, create, clone, pull, diff or propose cmd-*.sh commands"
source ${WORKSPACE_SCRIPTS}/args/arg-commands.sh || exit 1 ;

shift $#;

if [ ! "${NEW}" == '_none_' ] ; then
  commands_new "${NEW}" "${WORKSPACE}" "${LABEL}" ;
elif [ ! "${CLONE}" == '_none_' ] ; then
  commands_clone "${CLONE}" "${TO}" "${WORKSPACE}" ;
elif [ ! "${PULL}" == '_none_' ] ; then
  commands_pull "${PULL}" ;
elif [ ! "${DIFF}" == '_none_' ] ; then
  commands_diff "${DIFF}" ;
elif [ ! "${PROPOSE}" == '_none_' ] ; then
  commands_propose "${PROPOSE}" "${SUMMARY}" "$([ "${CONFIRM}" == 'yes' ] && echo yes || echo no)" ;
elif [ "${LIST_REMOTE}" == 'yes' ] ; then
  commands_list_remote ;
else
  commands_list "${WORKSPACE}" ;
fi
