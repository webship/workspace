#!/usr/bin/env bash

# ElevenLabs for the final voiceover of a narrated video: key and credits, voices, a script's timed
# sections, the voiceover itself, a recorded take polished, and the hosted MCP server.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

elevenlabs_main "$@" ;
