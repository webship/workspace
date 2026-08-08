#!/usr/bin/env bash

# workspace-name: DruStack

echo "*---------------------------------------------------*";
echo "| Build DruStack                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/drustack           |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/drustack" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/drustack" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/drustack" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/drustack" ;
cd "${WORKSPACE_ROOT}/${doc_name}/drustack" ;

ddev config --project-type=drupal --docroot=web --project-name=drustack --auto ;
ddev start ;

ddev composer create-project drustack/framework-standard-edition:^8 . --no-interaction;