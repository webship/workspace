#!/usr/bin/env bash

echo "*---------------------------------------------------*";
echo "| Build Cucumber                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/cucumber           |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/cucumber" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/cucumber" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/cucumber" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/cucumber" ;
cd "${WORKSPACE_ROOT}/${doc_name}/cucumber" ;

ddev config --project-type=drupal --docroot=web --project-name=cucumber --auto ;
ddev start ;

ddev composer create-project webship/cucumber-project:11.0.x-dev . --stability dev --no-interaction;
