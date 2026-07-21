#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Base                                        |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/govcms8            |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dev" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dev" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dev" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dev" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dev" ;

ddev config --project-type=drupal --docroot=web --project-name=dev --auto ;
ddev start ;

ddev composer create-project --stability . --prefer-dist govcms/govcms8-project govcms8;