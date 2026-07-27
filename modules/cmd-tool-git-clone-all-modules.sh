#!/bin/usr/env bash

echo "*-----------------------------------------------------------*";
echo "| GIT clone all modules in                                  |";
echo "*-----------------------------------------------------------*";
echo "| ${WEBSHIP_WORKSPACE_CONFIG}/workspace.modules.settings.yml";
echo "*-----------------------------------------------------------*"

current_path=$(pwd);

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.modules.settings.yml);

cd ${WEBSHIP_WORKSPACE_ROOT}/modules/ ;

# Delete modules.
for module_name in "${modules[@]}"
do
  sudo rm -rf ${WEBSHIP_WORKSPACE_ROOT}/modules/${module_name};
done

# GIT clone modules.
for module_name in "${modules[@]}"
do
  git clone git@git.drupal.org:project/${module_name}.git ;
  echo "*-----------------------------------------------------------*";
done
