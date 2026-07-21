#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Law Firm                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/law_firm           |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);

drush dl law_firm --drupal-project-rename=law_firm;

# NOTE: uses legacy 'drush dl' which is unsupported by modern Drush --
# this profile needs a modern composer-based install method before it can
# be brought into a DDEV project like the other cmd-build-profiles-*.sh scripts.
