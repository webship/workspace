#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Openfed                                     |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/openfed            |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/openfed" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/openfed" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/openfed" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/openfed" ;
cd "${WORKSPACE_ROOT}/${doc_name}/openfed" ;

ddev config --project-type=drupal --docroot=web --project-name=openfed --auto ;
ddev start ;

ddev composer create-project openfed/openfed8-project:~10 . --no-interaction;