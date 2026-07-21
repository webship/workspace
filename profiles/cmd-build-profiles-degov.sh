#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build degov                                       |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/degov              |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/degov" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/degov" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/degov" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/degov" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/degov" ;

ddev config --project-type=drupal --docroot=web --project-name=degov --auto ;
ddev start ;

ddev composer create-project degov/degov-project . --no-interaction;