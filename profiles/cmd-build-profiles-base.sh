#!/bin/usr/env bash

echo "*---------------------------------------------------*";
echo "| Build Base                                        |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/base               |";
echo "*---------------------------------------------------*";

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);

drush dl base --drupal-project-rename=base;

# NOTE: uses legacy 'drush dl' which is unsupported by modern Drush --
# this profile needs a modern composer-based install method before it can
# be brought into a DDEV project like the other cmd-build-profiles-*.sh scripts.
