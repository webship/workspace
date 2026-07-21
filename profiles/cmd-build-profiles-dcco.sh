#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build dcco                                        |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/dcco               |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);

drush dl dcco-8.x-2.x-dev --drupal-project-rename=dcco;

# NOTE: uses legacy 'drush dl' which is unsupported by modern Drush --
# this profile needs a modern composer-based install method before it can
# be brought into a DDEV project like the other cmd-build-profiles-*.sh scripts.
