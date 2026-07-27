#!/bin/usr/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.dev.settings.yml);


ARGPARSE_DESCRIPTION="Remove a project"
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
EOF

shift $#;


# Change directory to the workspace for this full operation.
cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name};

if [ -d "${PROJECT_NAME}" ]; then
  echo "--------------";
  (cd ${PROJECT_NAME} && ddev delete -y -O 2>/dev/null) ;
  sudo rm -rf ${PROJECT_NAME}
  echo "Deleted: ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  echo "--------------";
fi

