#!/bin/usr/env bash



# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load the workspace settings extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.test.settings.yml);

ARGPARSE_DESCRIPTION="Backup a project"
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
EOF

shift $#;

backup_time=$( date '+%Y-%m-%d_%H-%M-%S' );
tar -cvzf ${backups}/${doc_name}/${doc_name}---${PROJECT_NAME}--${backup_time}.tar.gz ${PROJECT_NAME} ;
(cd ${PROJECT_NAME} && ddev export-db --file=${backups}/${doc_name}/${doc_name}---${PROJECT_NAME}--${backup_time}-db.sql.gz) ;

