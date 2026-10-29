#!/usr/bin/env bash

# Push this folder to a Google Drive folder (the dashboard's Sync button), and register the Google Drive MCP server.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.videos.settings.yml);

drive_sync_main "${doc_name}" "$@" ;
