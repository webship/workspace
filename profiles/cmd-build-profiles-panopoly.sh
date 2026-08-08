#!/usr/bin/env bash

# workspace-name: Panopoly

echo "*---------------------------------------------------*";
echo "| Build Panopoly                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/panopoly           |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/panopoly" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/panopoly" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/panopoly" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/panopoly" ;
cd "${WORKSPACE_ROOT}/${doc_name}/panopoly" ;

ddev config --project-type=drupal --docroot=web --project-name=panopoly --auto ;
ddev start ;

ddev composer create-project panopoly/panopoly-composer-template:9.x-dev . --no-interaction;