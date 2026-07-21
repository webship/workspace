#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build media_dev                                    |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/bamedia_devse      |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);

drush dl media_dev --drupal-project-rename=media_dev;

# NOTE: uses legacy 'drush dl' which is unsupported by modern Drush --
# this profile needs a modern composer-based install method before it can
# be brought into a DDEV project like the other cmd-build-profiles-*.sh scripts.
