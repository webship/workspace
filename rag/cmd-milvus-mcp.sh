#!/usr/bin/env bash

# workspace-name: Milvus (mcp)

# Give the Milvus database to the Claude Code CLI over MCP — one registration covers every
# collection in it, because the server's tools list and search the whole database.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings — the MCP package and the instance defaults live in the milvus: block.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.rag.settings.yml);

ARGPARSE_DESCRIPTION="Register, unregister or run the Milvus MCP server for the Claude Code CLI"
source ${WORKSPACE_SCRIPTS}/args/arg-milvus-mcp.sh || exit 1 ;

shift $#;

milvus_mcp ;
