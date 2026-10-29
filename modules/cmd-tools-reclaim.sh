#!/usr/bin/env bash

# Reclaim the disk that REMOVED projects left behind — their DDEV databases, snapshots, built images
# and containers. A project whose folder is still on disk is never touched, stopped or not.
#
# The sweep is machine-wide wherever you run it: it takes no project name, reads WORKSPACE_ROOT, and
# protects every project folder in the tree — so this copy behaves identically to the one in any other
# workspace. It ships in each workspace that leans on DDEV, graphify or RAG for the same reason
# cmd-tools-graphify.sh does: the folder you are standing in is where you look for a cmd-tools-*.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.modules.settings.yml);

ARGPARSE_DESCRIPTION="Reclaim disk from projects that no longer have a folder — dry run unless --apply"
source ${WORKSPACE_SCRIPTS}/args/arg-reclaim.sh || exit 1 ;

shift $#;

reclaim_command ;
