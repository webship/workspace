#!/usr/bin/env bash

# Move skills between the three places they live: this workspace folder,
# the Claude Code CLI (~/.claude/skills), and the shared repository
# github.com/webship/ai-agents.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.ai-skills.settings.yml);

ARGPARSE_DESCRIPTION="Show, fetch, pull, install or clone skills (workspace | ~/.claude | webship/ai-agents)"
source ${WORKSPACE_SCRIPTS}/args/arg-ai-items.sh || exit 1 ;

shift $#;

if [ "${PROPOSE}" == 'yes' ] ; then
  ai_items_propose "ai-skills" "${NAME}" "${SUMMARY}" "$([ "${CONFIRM}" == 'yes' ] && echo yes || echo no)" ;
elif [ ! "${CLONE_TO}" == '_none_' ] ; then
  clone_ai_item "ai-skills" "${NAME}" "${CLONE_TO}" || exit 1 ;
  tailor_ai_item "ai-skills" "${CLONED_AI_ITEM}" "${CLONE_TO}" "${PURPOSE}" ;
elif [ "${LIST_REMOTE}" == 'yes' ] ; then
  ai_items_list_remote "ai-skills" ;
elif [ "${FETCH}" == 'yes' ] ; then
  ai_items_fetch "ai-skills" "${NAME}" claude ;
elif [ "${PULL}" == 'yes' ] ; then
  if [ "${SOURCE}" == 'claude' ] ; then
    ai_items_from_claude "ai-skills" "${NAME}" "${FILTER}" ;
  else
    ai_items_fetch "ai-skills" "${NAME}" workspace ;
  fi
elif [ "${INSTALL}" == 'yes' ] ; then
  install_ai_item "ai-skills" "${NAME}" "${TO}" ;
elif [ ! "${ADD}" == '_none_' ] ; then
  ai_items_add "ai-skills" "${NAME}" "${ADD}" "${TO}" ;
elif [ "${UPDATE}" == 'yes' ] ; then
  ai_items_update "ai-skills" "${NAME}" "${TO}" ;
elif [ "${CHECK}" == 'yes' ] ; then
  ai_items_check "ai-skills" "${NAME}" "${TO}" ;
else
  ai_items_status "ai-skills" ;
fi
