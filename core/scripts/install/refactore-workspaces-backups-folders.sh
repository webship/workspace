#!/bin/usr/env bash

echo '*--------------------------------------------------*';
echo '|   Refactor workspaces backups folders       |';
echo '*--------------------------------------------------*';
echo ;
read -p "Are you sure? [Yes/No]" -n 1 -r
echo ;
if [[ ! $REPLY =~ ^[Yy]$ ]]
then
  exit 1;
fi

current_path=$(pwd);

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Delete old workspace backups.
for workspace_name in "${workspaces[@]}"
do
  sudo rm -rf ${backups}/${workspace_name};
  mkdir ${backups}/${workspace_name};
  printf "# %s Backups\n\nWe place our %s backups in this folder\n" "${workspace_name}" "${workspace_name}" >> ${backups}/${workspace_name}/README.md
done

