#!/usr/bin/env bash

# workspace-name: Theme

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.themes.settings.yml);

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

cp -r ${drupal_template_drupal_theme_name} ${WORKSPACE_ROOT}/themes/${theme_name} ;
cd ${WORKSPACE_ROOT}/themes/${theme_name} ;
composer require drupal/${theme_name} ;
