#!/bin/usr/env bash

echo "*-------------------------------------------------*";
echo "| Build Open Social                               |";
echo "*-------------------------------------------------*";
echo "| From: https://www.drupal.org/project/social     |";
echo "*-------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/social" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/social" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/social" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/social" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/social" ;

ddev config --project-type=drupal --docroot=web --project-name=social --auto ;
ddev start ;

ddev composer create-project goalgorilla/social_template:dev-master . --no-interaction;