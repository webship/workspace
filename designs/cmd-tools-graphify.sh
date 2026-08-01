#!/usr/bin/env bash

# Map a project in this workspace into a queryable knowledge graph with
# graphify (https://github.com/Graphify-Labs/graphify), or ask an existing
# graph a question.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.designs.settings.yml);

ARGPARSE_DESCRIPTION="Build or query the knowledge graph of a project in the designs workspace"
source ${WORKSPACE_SCRIPTS}/args/arg-graphify.sh || exit 1 ;

shift $#;

if [ ! "${STORE}" == '_none_' ] ; then
  ensure_graphify || exit 1 ;
  graphify_store_url "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" "${STORE}" ;
elif [ -n "${QUERY}" ] ; then
  graphify_query_project ;
else
  graphify_project ;
fi
