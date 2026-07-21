#!/bin/usr/env bash

echo "*-----------------------------------------------------------*";
echo "| Install all Front-End themes                              |";
echo "*-----------------------------------------------------------*";
echo "| ${WEBSHIP_WORKSPACE_CONFIG}/workspace.themes.settings.yml";
echo "*-----------------------------------------------------------*"

current_path=$(pwd);

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.themes.settings.yml);

# Change file mod and owner.
sudo chmod 775 -R ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;
sudo chown www-data:${USER} -R ${WEBSHIP_WORKSPACE_ROOT}/themes/ ;

# Install all themes in the themes list.
for theme_name in "${themes[@]}"
do
  cd "${WEBSHIP_WORKSPACE_ROOT}/themes/" ;
  . cmd-install-theme.sh ${theme_name} ;
done
