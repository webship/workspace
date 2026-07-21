#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Pino                                        |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/pino               |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/pino" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/pino" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/pino" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/pino" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/pino" ;

ddev config --project-type=drupal --docroot=web --project-name=pino --auto ;
ddev start ;

ddev composer create-project risse/pino-project . --no-interaction;