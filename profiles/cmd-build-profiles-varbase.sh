#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Varbase                                     |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/varbase            |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/varbase" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/varbase" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/varbase" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/varbase" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/varbase" ;

ddev config --project-type=drupal --docroot=web --project-name=varbase --auto ;
ddev start ;

ddev composer create-project Vardot/varbase-project . --no-interaction;