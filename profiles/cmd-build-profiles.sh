#!/bin/usr/env bash

current_path=$(pwd);

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.profiles.settings.yml);

# Delete old profiles.
for profile_name in "${profiles[@]}"
do
  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name} ;
  sudo rm -rf ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${profile_name};
done

# Build all profiles in the profiles list.
for profile_name in "${profiles[@]}"
do
  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name} ;
  . cmd-build-profiles-${profile_name}.sh;
done

# Change file mod and owner.
sudo chmod 775 -R ${current_path};
sudo chown www-data:${USER} -R ${current_path};

