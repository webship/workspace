#!/usr/bin/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.sandboxes.settings.yml);

ARGPARSE_DESCRIPTION="Cancle users from a project and delete their content"
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('DISTRIBUTION_NAME',
                    help='The name of the user list for the profile.')
EOF

shift $#;

distribution_name=${DISTRIBUTION_NAME};

cancel_users ${PROJECT_NAME} ${distribution_name};
