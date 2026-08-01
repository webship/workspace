#!/bin/usr/env bash

echo "*-----------------------------------------------------------*";
echo "| Build all Front-End themes                                |";
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

# Refuse to run with an empty name. `rm -rf ${WORKSPACE_ROOT}/themes/${name}` with an unset name
# deletes the whole themes workspace, which is what the old `vdo_`-prefixed settings key caused:
# it flattened to a different variable than the one read here, so this was empty every time.
if [ -z "${drupal_template_drupal_theme_name}" ] ; then
  echo "drupal.template_drupal_theme_name is not set in core/config/workspace.themes.settings.yml — refusing to run." ;
  exit 1 ;
fi


cd ${WORKSPACE_ROOT}/themes/ ;

# Delete old themes.
for theme_name in "${themes[@]}"
do
  sudo rm -rf ${WORKSPACE_ROOT}/themes/${theme_name};
done

cd ${WORKSPACE_ROOT}/themes/ ;

sudo rm -rf ${WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
composer create-project drupal/recommended-project:~9.0 ${drupal_template_drupal_theme_name} --stability dev --no-interaction ;


sudo chmod 775 -R ${WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;
sudo chown www-data:${USER} -R ${WORKSPACE_ROOT}/themes/${drupal_template_drupal_theme_name} ;

# Build all themes in the themes list.
for theme_name in "${themes[@]}"
do
  cd ${WORKSPACE_ROOT}/themes/ ;
  . cmd-build-theme.sh ${theme_name};
done

# Change file mod and owner.
sudo chmod 775 -R ${WORKSPACE_ROOT}/themes/ ;
sudo chown www-data:${USER} -R ${WORKSPACE_ROOT}/themes/ ;

