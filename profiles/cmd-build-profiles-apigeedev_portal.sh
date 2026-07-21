#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Apigee devportal                            |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/apigeedev_portal   |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);

drush dl apigeedev_portal --drupal-project-rename=apigeedev_portal;

# NOTE: uses legacy 'drush dl' which is unsupported by modern Drush --
# this profile needs a modern composer-based install method before it can
# be brought into a DDEV project like the other cmd-build-profiles-*.sh scripts.
