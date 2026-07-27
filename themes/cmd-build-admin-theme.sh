#!/bin/usr/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
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
