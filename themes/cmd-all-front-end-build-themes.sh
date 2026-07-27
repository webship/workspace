#!/bin/usr/env bash

echo "*-----------------------------------------------------------*";
echo "| Build all Front-End themes                                |";
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

# Delete old themes.
for theme_name in "${themes[@]}"
do
  sudo rm -rf ${WEBSHIP_WORKSPACE_ROOT}/themes/${theme_name};
done

cd ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;

sudo rm -rf ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
composer create-project drupal/recommended-project:~9.0 ${drupal_template_drupal_theme_name} --stability dev --no-interaction ;


sudo chmod 775 -R ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
sudo chown www-data:${USER} -R ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;

# Build all themes in the themes list.
for theme_name in "${themes[@]}"
do
  cd ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;
  . cmd-build-theme.sh ${theme_name};
done

# Change file mod and owner.
sudo chmod 775 -R ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;
sudo chown www-data:${USER} -R ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;

