#!/usr/bin/env bash

# Propose one prompt back to the shared repository — webship/ai-agents by default, or whatever
# sources.ai_items names in core/config/settings.yml.
#
# Nothing is written to the repository here. The plan is printed; --confirm hands it to the AI
# agent, which files the issue and opens the pull request against a branch.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.prompts.settings.yml);

ARGPARSE_DESCRIPTION="Propose one prompt to ${AI_ITEMS_REPO}"
source ${WORKSPACE_SCRIPTS}/args/arg-propose-item.sh || exit 1 ;

shift $#;

items_propose "prompts" "${NAME}" "${SUMMARY}" "$([ "${CONFIRM}" == 'yes' ] && echo yes || echo no)" ;
