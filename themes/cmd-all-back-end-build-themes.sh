#!/bin/usr/env bash

echo "*-----------------------------------------------------------*";
echo "| Build all Back-End admin themes                           |";
echo "*-----------------------------------------------------------*";
echo "| ${WORKSPACE_CONFIG}/workspace.themes.settings.yml";
echo "*-----------------------------------------------------------*"

current_path=$(pwd);

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.themes.settings.yml);

cd ${WORKSPACE_ROOT}/themes/ ;

# Delete old Admin themes.
for admin_theme_name in "${admin_themes[@]}"
do
  sudo rm -rf ${WORKSPACE_ROOT}/themes/${admin_theme_name};
done


cd ${WORKSPACE_ROOT}/themes/ ;

sudo rm -rf ${WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
composer create-project drupal/recommended-project:~9.0 ${drupal_template_drupal_theme_name} --stability dev --no-interaction ;


sudo chmod 775 -R ${WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
sudo chown www-data:${USER} -R ${WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;


# Build all admin themes in the admin theme list.
for admin_theme_name in "${admin_themes[@]}"
do
  cd ${WORKSPACE_ROOT}/themes/ ;
  . cmd-build-admin-theme.sh ${admin_theme_name};
done

# Change file mod and owner.
sudo chmod 775 -R ${WORKSPACE_ROOT}/themes/ ;
sudo chown www-data:${USER} -R ${WORKSPACE_ROOT}/themes/ ;

