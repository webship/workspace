#!/usr/bin/env bash

# workspace-name: Penpot (mcp)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings — every default this command uses lives in the penpot: block there.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.designs.settings.yml);

ARGPARSE_DESCRIPTION="Run and register the Penpot MCP server for design agents"
source ${WORKSPACE_SCRIPTS}/args/arg-penpot-mcp.sh || exit 1 ;

shift $#;

penpot_mcp ;
