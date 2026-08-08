#!/usr/bin/env bash

# workspace-name: Dropsolid Rocketship

echo "*---------------------------------------------------*";
echo "| Build Dropsolid Rocketship                        |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/dropsolid_rocketship |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);

if [ -d "${WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ;
cd "${WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ;

ddev config --project-type=drupal --docroot=web --project-name=dropsolid_rocketship --auto ;
ddev start ;

ddev composer create-project dropsolid/rocketship . --no-dev --no-interaction;