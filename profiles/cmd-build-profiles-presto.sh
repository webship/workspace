#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Presto! -  Commerce Integration             |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/presto             |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/presto" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/presto" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/presto" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/presto" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/presto" ;

ddev config --project-type=drupal --docroot=web --project-name=presto --auto ;
ddev start ;

ddev composer create-project sitback/presto-project . --stability dev --no-interaction;