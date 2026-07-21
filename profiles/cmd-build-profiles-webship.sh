#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Webship                                     |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/webship            |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/webship" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/webship" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/webship" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/webship" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/webship" ;

ddev config --project-type=drupal --docroot=web --project-name=webship --auto ;
ddev start ;

ddev composer create-project webship/webship-project:9.1.x-dev . --stability dev --no-interaction;