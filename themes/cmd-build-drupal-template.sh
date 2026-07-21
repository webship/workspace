#!/bin/usr/env bash

echo "*-----------------------------------------------------------*";
echo "|  Build Drupal template                                    |";
echo "*-----------------------------------------------------------*";

current_path=$(pwd);

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.themes.settings.yml);

cd ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;

sudo rm -rf ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
composer create-project drupal/recommended-project:~9.0 ${drupal_template_drupal_theme_name} --stability dev --no-interaction ;


sudo chmod 775 -R ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
sudo chown www-data:${USER} -R ${WEBSHIP_WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
