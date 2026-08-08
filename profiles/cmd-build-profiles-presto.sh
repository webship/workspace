#!/usr/bin/env bash

# workspace-name: Presto! -  Commerce Integration

echo "*---------------------------------------------------*";
echo "| Build Presto! -  Commerce Integration             |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/presto             |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/presto" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/presto" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/presto" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/presto" ;
cd "${WORKSPACE_ROOT}/${doc_name}/presto" ;

ddev config --project-type=drupal --docroot=web --project-name=presto --auto ;
ddev start ;

ddev composer create-project sitback/presto-project . --stability dev --no-interaction;