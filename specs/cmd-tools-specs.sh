#!/usr/bin/env bash

# workspace-name: Shared specs

# The specs worth sharing — the templates every spec starts from, and the general spec
# (00-constitution.md) of each product — kept in step with the shared repository the AI agents,
# skills and prompts come from. A numbered spec is about one change in one tree and is not shared;
# see core/scripts/functions/fun-specs-share.sh for why.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.specs.settings.yml);

ARGPARSE_DESCRIPTION="Keep the shared specs — the templates and the product constitutions — in step"
source ${WORKSPACE_SCRIPTS}/args/arg-specs.sh || exit 1 ;

shift $#;

if [ "${LIST_REMOTE}" == 'yes' ] ; then
  specs_list_remote ;
elif [ ! "${DIFF}" == '_none_' ] ; then
  specs_diff "${DIFF}" ;
elif [ ! "${PULL}" == '_none_' ] ; then
  specs_pull "${PULL}" ;
elif [ "${SHARE}" == 'yes' ] ; then
  specs_propose ;
else
  specs_status ;
fi
