#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Droopler                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/droopler           |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/droopler" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/droopler" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/droopler" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/droopler" ;
cd "${WORKSPACE_ROOT}/${doc_name}/droopler" ;

ddev config --project-type=drupal --docroot=web --project-name=droopler --auto ;
ddev start ;

ddev composer create-project droptica/droopler-project . --no-interaction;