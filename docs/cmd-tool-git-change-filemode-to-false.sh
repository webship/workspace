#!/bin/usr/env bash

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.docs.settings.yml);

ARGPARSE_DESCRIPTION="Change a project's git core.fileMode to false"
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
ARGEOF

shift $#;

cd ${WEBSHIP_WORKSPACE_ROOT}/docs/${PROJECT_NAME} ;
git config core.fileMode false ;
