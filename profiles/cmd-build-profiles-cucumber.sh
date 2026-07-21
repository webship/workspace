#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Cucumber                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/cucumber           |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/cucumber" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/cucumber" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/cucumber" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/cucumber" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/cucumber" ;

ddev config --project-type=drupal --docroot=web --project-name=cucumber --auto ;
ddev start ;

ddev composer create-project webship/cucumber-project:9.0.x-dev . --stability dev --no-interaction;