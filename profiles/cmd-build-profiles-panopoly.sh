#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Panopoly                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/panopoly           |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/panopoly" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/panopoly" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/panopoly" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/panopoly" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/panopoly" ;

ddev config --project-type=drupal --docroot=web --project-name=panopoly --auto ;
ddev start ;

ddev composer create-project panopoly/panopoly-composer-template:9.x-dev . --no-interaction;