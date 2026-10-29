#!/usr/bin/env bash

# workspace-name: Add or list avatar characters

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.avatars.settings.yml);

ARGPARSE_DESCRIPTION="Add, list or remove the characters of an avatar project, with a VRM body from a URL or Open Source Avatars"
source ${WORKSPACE_SCRIPTS}/args/arg-avatar-character.sh || exit 1 ;

shift $#;

avatar_character ;
