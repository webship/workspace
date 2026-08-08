#!/usr/bin/env bash

echo "*---------------------------------------------------*";
echo "| Build OpenLucius                                  |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/openlucius         |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/openlucius" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/openlucius" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/openlucius" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/openlucius" ;
cd "${WORKSPACE_ROOT}/${doc_name}/openlucius" ;

ddev config --project-type=drupal --docroot=web --project-name=openlucius --auto ;
ddev start ;

ddev composer create-project lucius-digital/openlucius-project . --stability dev --no-interaction;