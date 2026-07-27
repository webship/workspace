#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Opigno LMS                                  |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/opigno_lms         |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/opigno_lms" ]; then
  (cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/opigno_lms" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/opigno_lms" ;
fi

mkdir -p "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/opigno_lms" ;
cd "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/opigno_lms" ;

ddev config --project-type=drupal --docroot=web --project-name=opigno_lms --auto ;
ddev start ;

ddev composer create-project opigno/opigno-composer . --no-interaction;