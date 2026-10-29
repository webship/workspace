#!/usr/bin/env bash

# Move agents between the three places they live: this workspace folder,
# the Claude Code CLI (~/.claude/agents), and the shared repository
# github.com/webship/ai-agents.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.ai-agents.settings.yml);

ARGPARSE_DESCRIPTION="Show, fetch, pull, install or clone agents (workspace | ~/.claude | webship/ai-agents)"
source ${WORKSPACE_SCRIPTS}/args/arg-ai-items.sh || exit 1 ;

shift $#;

if [ "${PROPOSE}" == 'yes' ] ; then
  ai_items_propose "ai-agents" "${NAME}" "${SUMMARY}" "$([ "${CONFIRM}" == 'yes' ] && echo yes || echo no)" ;
elif [ ! "${CLONE_TO}" == '_none_' ] ; then
  clone_ai_item "ai-agents" "${NAME}" "${CLONE_TO}" || exit 1 ;
  tailor_ai_item "ai-agents" "${CLONED_AI_ITEM}" "${CLONE_TO}" "${PURPOSE}" ;
elif [ "${LIST_REMOTE}" == 'yes' ] ; then
  ai_items_list_remote "ai-agents" ;
elif [ "${FETCH}" == 'yes' ] ; then
  ai_items_fetch "ai-agents" "${NAME}" claude ;
elif [ "${PULL}" == 'yes' ] ; then
  if [ "${SOURCE}" == 'claude' ] ; then
    ai_items_from_claude "ai-agents" "${NAME}" "${FILTER}" ;
  else
    ai_items_fetch "ai-agents" "${NAME}" workspace ;
  fi
elif [ "${INSTALL}" == 'yes' ] ; then
  install_ai_item "ai-agents" "${NAME}" "${TO}" ;
elif [ ! "${ADD}" == '_none_' ] ; then
  ai_items_add "ai-agents" "${NAME}" "${ADD}" "${TO}" ;
elif [ "${UPDATE}" == 'yes' ] ; then
  ai_items_update "ai-agents" "${NAME}" "${TO}" ;
elif [ "${CHECK}" == 'yes' ] ; then
  ai_items_check "ai-agents" "${NAME}" "${TO}" ;
else
  ai_items_status "ai-agents" ;
fi
