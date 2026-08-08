#!/usr/bin/env bash

# workspace-name: Drutopia

echo "*---------------------------------------------------*";
echo "| Build Drutopia                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/drutopia           |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/drutopia" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/drutopia" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/drutopia" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/drutopia" ;
cd "${WORKSPACE_ROOT}/${doc_name}/drutopia" ;

ddev config --project-type=drupal --docroot=web --project-name=drutopia --auto ;
ddev start ;

ddev composer create-project drutopia/drutopia_template:dev-master . --no-interaction;