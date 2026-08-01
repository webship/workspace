#!/usr/bin/env bash

# workspace-name: RAG indexes (list, search, serve over MCP)

# Work with the project RAG indexes held in the Milvus instance of this workspace.
# The indexes are BUILT from each project's own workspace folder:
#   cd ~/workspace/<workspace> && bash cmd-tools-ragify.sh <project>

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.rag.settings.yml);

ARGPARSE_DESCRIPTION="List, describe, search and remove the project RAG indexes in ~/workspace/rag"
source ${WORKSPACE_SCRIPTS}/args/arg-rag.sh || exit 1 ;

shift $#;

rag_command ;
