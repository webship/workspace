#!/bin/usr/env bash

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.themes.settings.yml);

# GET the project name argument.
if [ "$1" != "" ]; then
    theme_name=$1;
else
  echo "Please add the name of your theme.";
  exit 1;
fi

echo "*-----------------------------------------------------------*";
echo "| Build ${theme_name}";
echo "*-----------------------------------------------------------*";

cp -r ${drupal_template_drupal_theme_name} ${WEBSHIP_WORKSPACE_ROOT}/themes/${theme_name} ;
cd ${WEBSHIP_WORKSPACE_ROOT}/themes/${theme_name} ;
composer require drupal/${theme_name} ;
