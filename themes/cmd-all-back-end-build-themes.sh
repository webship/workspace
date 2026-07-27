#!/bin/usr/env bash

echo "*-----------------------------------------------------------*";
echo "| Build all Back-End admin themes                           |";
echo "*-----------------------------------------------------------*";
echo "| ${WEBSHIP_WORKSPACE_CONFIG}/workspace.themes.settings.yml";
echo "*-----------------------------------------------------------*"

current_path=$(pwd);

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.themes.settings.yml);

cd ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;

# Delete old Admin themes.
for admin_theme_name in "${admin_themes[@]}"
do
  sudo rm -rf ${WEBSHIP_WORKSPACE_ROOT}/themes/${admin_theme_name};
done


cd ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;

sudo rm -rf ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
composer create-project drupal/recommended-project:~9.0 ${drupal_template_drupal_theme_name} --stability dev --no-interaction ;


sudo chmod 775 -R ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
sudo chown www-data:${USER} -R ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;


# Build all admin themes in the admin theme list.
for admin_theme_name in "${admin_themes[@]}"
do
  cd ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;
  . cmd-build-admin-theme.sh ${admin_theme_name};
done

# Change file mod and owner.
sudo chmod 775 -R ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;
sudo chown www-data:${USER} -R ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;

