#!/usr/bin/env bash

# workspace-name: Avatar voices (Piper, ElevenLabs, browser)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.avatars.settings.yml);

ARGPARSE_DESCRIPTION="Set up the voices of an avatar project: free Piper voices, the ElevenLabs key, and their status"
source ${WORKSPACE_SCRIPTS}/args/arg-avatar-voice.sh || exit 1 ;

shift $#;

avatar_voice ;
