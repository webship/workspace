#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Bear                                        |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/bear               |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/alpha" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/alpha" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/alpha" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/alpha" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/alpha" ;

ddev config --project-type=drupal --docroot=web --project-name=alpha --auto ;
ddev start ;

ddev composer create-project -s . zivtech/bear-project bear;