#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Dropsolid Rocketship                        |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/dropsolid_rocketship |";
echo "*---------------------------------------------------*";
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/dropsolid_rocketship" ;

ddev config --project-type=drupal --docroot=web --project-name=dropsolid_rocketship --auto ;
ddev start ;

ddev composer create-project dropsolid/rocketship . --no-dev --no-interaction;