#!/usr/bin/env bash

echo "*---------------------------------------------------*";
echo "| Build Mandatory                                   |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/mandatory          |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/mandatory" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/mandatory" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/mandatory" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/mandatory" ;
cd "${WORKSPACE_ROOT}/${doc_name}/mandatory" ;

ddev config --project-type=drupal --docroot=web --project-name=mandatory --auto ;
ddev start ;

ddev composer create-project drupal/recommended-project:~9 . --stability dev --no-interaction;
ddev composer config minimum-stability dev ;
ddev composer require drupal/mandatory ;
cd "${WORKSPACE_ROOT}/${doc_name}";

