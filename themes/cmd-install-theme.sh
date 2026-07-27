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
echo "| Install ${theme_name}";
echo "*-----------------------------------------------------------*";



cd "${WEBSHIP_WORKSPACE_ROOT}/themes/${theme_name}/web";

ddev drush site-install standard --yes \
--site-name="Theme ${theme_name}" \
--account-name="${account_name}" \
--account-pass="${account_pass}" \
--account-mail="${account_mail}" \
--db-url="mysql://db:db@db/db" ;

ddev drush config-set system.performance css.preprocess 0 --yes ;
ddev drush config-set system.performance js.preprocess 0 --yes ;
ddev drush config-set system.logging error_level all --yes ;
ddev drush cr ;

ddev drush theme-enable ${theme_name} ;
ddev drush config-set system.theme default ${theme_name} --yes ;
ddev drush config-set system.theme admin seven --yes ;




