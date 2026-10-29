#!/usr/bin/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);


ARGPARSE_DESCRIPTION="Remove a site template project"
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    default='_none_',
                    nargs='?',
                    help='The name of the project.')
parser.add_argument('-o', '--orphans',
                    action='store_true',
                    default=False,
                    help='List DDEV entries whose project directory is gone, instead of removing anything.')
parser.add_argument('-f', '--force',
                    action='store_true',
                    default=False,
                    help='Remove even when the folder is the main git checkout other worktrees depend on, or holds commits and changes that are on no remote. Both are refused without it.')
parser.add_argument('-b', '--backup',
                    action='store_true',
                    default=False,
                    help='Export the database into backups/ before anything is deleted. Off by default: a remove is a remove.')
EOF

shift $#;
trim_project_name ;   # "v11x00b1/" -> "v11x00b1" — see functions/fun-project-name.sh


# Change directory to the workspace for this full operation.
cd ${WORKSPACE_ROOT}/${doc_name};

if [ "${ORPHANS}" == 'yes' ] ; then
  report_orphans ;
elif [ "${PROJECT_NAME}" == '_none_' ] ; then
  echo "Name the project to remove, or pass --orphans to see DDEV entries with no directory." ;
  exit 1 ;
else
  remove_project "${PROJECT_NAME}" || exit 1 ;
fi
