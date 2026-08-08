#!/usr/bin/env bash

echo "*---------------------------------------------------*";
echo "| Build OpenRestaurant                              |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/openrestaurant     |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/openrestaurant" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/openrestaurant" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/openrestaurant" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/openrestaurant" ;
cd "${WORKSPACE_ROOT}/${doc_name}/openrestaurant" ;

ddev config --project-type=drupal --docroot=web --project-name=openrestaurant --auto ;
ddev start ;

ddev composer create-project openrestaurant/openrestaurant-project . --no-interaction;