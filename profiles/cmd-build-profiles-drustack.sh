#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build DruStack                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/drustack           |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drustack" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drustack" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drustack" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drustack" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drustack" ;

ddev config --project-type=drupal --docroot=web --project-name=drustack --auto ;
ddev start ;

ddev composer create-project drustack/framework-standard-edition:^8 . --no-interaction;