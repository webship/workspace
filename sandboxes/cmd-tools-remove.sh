#!/usr/bin/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.sandboxes.settings.yml);


ARGPARSE_DESCRIPTION="Remove a project"
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
EOF

shift $#;


# Change directory to the workspace for this full operation.
cd ${WORKSPACE_ROOT}/${doc_name};

if [ -d "${PROJECT_NAME}" ]; then
  echo "--------------";
  (cd ${PROJECT_NAME} && ddev delete -y -O 2>/dev/null) ;
  # DDEV projects are owned by the user running them, so no sudo: under the
  # dashboard (stdin closed) a sudo prompt would fail and leave the files.
  rm -rf ${PROJECT_NAME}
  if [ -d "${PROJECT_NAME}" ]; then
    echo "Could not delete: ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  else
    echo "Deleted: ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  fi
  echo "--------------";
fi
