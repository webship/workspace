#!/usr/bin/env bash

# workspace-name: Avatar and voice libraries

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.avatars.settings.yml);

ARGPARSE_DESCRIPTION="Where an avatar can get a body or a voice: libraries and providers, their licences, and what the app supports"
source ${WORKSPACE_SCRIPTS}/args/arg-avatar-catalog.sh || exit 1 ;

shift $#;

avatar_catalog ;
