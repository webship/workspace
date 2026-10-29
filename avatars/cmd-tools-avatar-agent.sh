#!/usr/bin/env bash

# workspace-name: Connect avatars to Claude Code agents

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.avatars.settings.yml);

ARGPARSE_DESCRIPTION="Give a character its own Claude Code agent, link a project agents into ~/.claude, and check Claude Code in the container"
source ${WORKSPACE_SCRIPTS}/args/arg-avatar-agent.sh || exit 1 ;

shift $#;

avatar_agent ;
