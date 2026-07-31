#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Orange E-commerce Profile                         |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/orange_ecom_profile|";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/orange_ecom_profile" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/orange_ecom_profile" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/orange_ecom_profile" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/orange_ecom_profile" ;
cd "${WORKSPACE_ROOT}/${doc_name}/orange_ecom_profile" ;

ddev config --project-type=drupal --docroot=web --project-name=orange_ecom_profile --auto ;
ddev start ;

ddev composer create-project acromedia/drupal-orange-project . --stability dev --no-interaction;