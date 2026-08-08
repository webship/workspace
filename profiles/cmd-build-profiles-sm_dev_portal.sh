#!/usr/bin/env bash

# workspace-name: Stratus Meridian Developer Portal

echo "*---------------------------------------------------*";
echo "| Build Stratus Meridian Developer Portal           |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/sm_dev_portal      |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/sm_dev_portal" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/sm_dev_portal" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/sm_dev_portal" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/sm_dev_portal" ;
cd "${WORKSPACE_ROOT}/${doc_name}/sm_dev_portal" ;

ddev config --project-type=drupal --docroot=web --project-name=sm_dev_portal --auto ;
ddev start ;

ddev composer create-project stratus-meridian/drupal8-composer-project:8.x-dev . --no-interaction;