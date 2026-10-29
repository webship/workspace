#!/usr/bin/env bash

# workspace-name: Graphs (list, collect, serve over MCP)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.graphs.settings.yml);

ARGPARSE_DESCRIPTION="Work with the project knowledge graphs kept in ~/workspace/graphs/"
source ${WORKSPACE_SCRIPTS}/args/arg-graphs.sh || exit 1 ;

shift $#;

graphs_command ;
