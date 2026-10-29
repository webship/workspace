#!/usr/bin/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.worklogs.settings.yml);

ARGPARSE_DESCRIPTION="Backup a worklog"
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
ARGEOF

shift $#;
trim_project_name ;   # "v11x00b1/" -> "v11x00b1" — see functions/fun-project-name.sh

backup_workspace_item "${PROJECT_NAME}" || exit 1 ;
