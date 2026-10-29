#!/usr/bin/env bash

# Run anything in a detached screen session that survives terminal exits and
# dashboard restarts, with a log the dashboard's Screens modal can follow.
#
#   bash cmd-tools-screen.sh --list
#   bash cmd-tools-screen.sh build-demo1 --run "bash cmd-webship11-0-x-project.sh demo1 --install"
#   bash cmd-tools-screen.sh build-demo1 --follow
#   bash cmd-tools-screen.sh build-demo1 --stop

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

ARGPARSE_DESCRIPTION="Run and manage detached screen sessions with dashboard-followable logs"
source ${WORKSPACE_SCRIPTS}/args/arg-screen.sh || exit 1 ;

shift $#;

screen_command ;
