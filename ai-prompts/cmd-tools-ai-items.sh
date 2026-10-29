#!/usr/bin/env bash

# Move prompts between this workspace folder and the shared repository
# github.com/webship/ai-agents (prompts/).
#
# A prompt is the whole `claude …` launch command for a NEW session, so the only
# way to use one is to start a session with it: the dashboard's New screen form, or
# the CLI by hand in the folder or project it should act on. It is not a slash
# command, so nothing here syncs into ~/.claude — see ../ai-commands for the kind
# that does.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.ai-prompts.settings.yml);

ARGPARSE_DESCRIPTION="Show, fetch, pull, install or clone prompts (workspace | ~/.claude | webship/ai-agents)"
source ${WORKSPACE_SCRIPTS}/args/arg-ai-items.sh || exit 1 ;

shift $#;

if [ "${PROPOSE}" == 'yes' ] ; then
  ai_items_propose "ai-prompts" "${NAME}" "${SUMMARY}" "$([ "${CONFIRM}" == 'yes' ] && echo yes || echo no)" ;
elif [ ! "${CLONE_TO}" == '_none_' ] ; then
  clone_ai_item "ai-prompts" "${NAME}" "${CLONE_TO}" || exit 1 ;
  tailor_ai_item "ai-prompts" "${CLONED_AI_ITEM}" "${CLONE_TO}" "${PURPOSE}" ;
elif [ "${LIST_REMOTE}" == 'yes' ] ; then
  ai_items_list_remote "ai-prompts" ;
elif [ "${FETCH}" == 'yes' ] ; then
  echo "A prompt starts a new screen session — it is not something ~/.claude loads." ;
  echo "Use --pull to bring shared prompts here. For slash commands, see ../ai-commands." ;
  exit 1 ;
elif [ "${PULL}" == 'yes' ] ; then
  if [ "${SOURCE}" == 'claude' ] ; then
    echo "Prompts are not loaded from ~/.claude — pull from the shared repo instead (--pull)." ;
    exit 1 ;
  fi
  ai_items_fetch "ai-prompts" "${NAME}" workspace ;
elif [ "${INSTALL}" == 'yes' ] || [ ! "${ADD}" == '_none_' ] || [ "${UPDATE}" == 'yes' ] || [ "${CHECK}" == 'yes' ] ; then
  # A prompt is run, not installed: the New screen form (or the CLI by hand) starts a
  # session with it in the folder or project it should act on. Nothing installs into
  # ~/.claude/commands or a project's .claude/, so there is nothing to add, check or
  # update there either. ../ai-commands is the kind that installs.
  echo "Prompts run a new screen session — they do not install into ~/.claude or a project." ;
  echo "Use --pull to bring shared prompts here, or --clone-to to customise one." ;
  exit 1 ;
else
  ai_items_status "ai-prompts" ;
fi
