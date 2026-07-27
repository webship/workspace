#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build University                                  |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/university         |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/university" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/university" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/university" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/university" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/university" ;

ddev config --project-type=drupal --docroot=web --project-name=university --auto ;
ddev start ;

ddev composer create-project front/university-project . --stability dev --no-interaction;