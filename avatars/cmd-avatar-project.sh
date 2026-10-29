#!/usr/bin/env bash

# workspace-name: Avatar (talking AI character)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.avatars.settings.yml);

ARGPARSE_DESCRIPTION="Build a talking AI character: the avatar app on DDEV, with Claude Code as its mind"
source ${WORKSPACE_SCRIPTS}/args/arg-avatar.sh || exit 1 ;

shift $#;

build_avatar ;
