#!/usr/bin/env bash

# Clone every module named in workspace.modules.settings.yml from git.drupal.org.
#
# Fills an empty modules/ folder in one go: each name in the `modules:` list is cloned over SSH,
# so it needs a drupal.org account with a key on it. An existing folder is left as it is.

echo "*-----------------------------------------------------------*";
echo "| GIT clone all modules in                                  |";
echo "*-----------------------------------------------------------*";
echo "| ${WORKSPACE_CONFIG}/workspace.modules.settings.yml";
echo "*-----------------------------------------------------------*"

current_path=$(pwd);

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.modules.settings.yml);

cd ${WORKSPACE_ROOT}/modules/ ;

# Delete modules.
for module_name in "${modules[@]}"
do
  sudo rm -rf ${WORKSPACE_ROOT}/modules/${module_name};
done

# GIT clone modules.
for module_name in "${modules[@]}"
do
  git clone git@git.drupal.org:project/${module_name}.git ;
  echo "*-----------------------------------------------------------*";
done
