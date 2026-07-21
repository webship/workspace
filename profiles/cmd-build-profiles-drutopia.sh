#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Drutopia                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/drutopia           |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drutopia" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drutopia" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drutopia" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drutopia" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/drutopia" ;

ddev config --project-type=drupal --docroot=web --project-name=drutopia --auto ;
ddev start ;

ddev composer create-project drutopia/drutopia_template:dev-master . --no-interaction;