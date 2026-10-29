#!/usr/bin/env bash

# Reclaim the disk that REMOVED projects left behind — their DDEV databases, snapshots, built images
# and containers. A project whose folder is still on disk is never touched, stopped or not.
#
# Machine-wide rather than per-workspace, but it takes a workspace to act on, which is why it
# stays a cmd-*.sh here rather than moving to core/scripts beside sync-tooling.sh:
# it sweeps every workspace at once and takes no project name.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.products.settings.yml);

ARGPARSE_DESCRIPTION="Reclaim disk from projects that no longer have a folder — dry run unless --apply"
source ${WORKSPACE_SCRIPTS}/args/arg-reclaim.sh || exit 1 ;

shift $#;

reclaim_command ;
