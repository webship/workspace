#!/bin/usr/env bash

current_path=$(pwd);
user_name="$USER";

# Include Bash YAML library.
. ../libs/bash-yaml.sh

# Include Bash Progress Bar library.
. ../libs/progress-bar.sh

# Load settings (sets: root, path, scripts, config, backups, workspaces, ...).
eval $(parse_yaml ../../config/settings.yml);

echo '*--------------------------------------------------*';
echo '*   Install default configs                        *';
echo '*--------------------------------------------------*';

echo ' ' >> $HOME/.bashrc ;
echo '# *--------------------------------------------------*' >> $HOME/.bashrc ;
echo '# *  Webship Workspace                               *' >> $HOME/.bashrc ;
echo '# *--------------------------------------------------*' >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
echo "Root working directory: ${root}";
echo '# Root working directory' >> $HOME/.bashrc ;
printf "WEBSHIP_WORKSPACE_ROOT=%s;\n" "$root" >> $HOME/.bashrc ;
printf "export WEBSHIP_WORKSPACE_ROOT=%s;\n" "$root" >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
echo "Path where we keep all configs and scripts: ${path}";
echo '# Path where we keep all configs and scripts' >> $HOME/.bashrc ;
printf "WEBSHIP_WORKSPACE_PATH=%s;\n" "$path" >> $HOME/.bashrc ;
printf "export WEBSHIP_WORKSPACE_PATH=%s;\n" "$path" >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
echo "Scripts: ${scripts}";
echo '# Scripts' >> $HOME/.bashrc ;
printf "WEBSHIP_WORKSPACE_SCRIPTS=%s;\n" "$scripts" >> $HOME/.bashrc ;
printf "export WEBSHIP_WORKSPACE_SCRIPTS=%s;\n" "$scripts" >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
echo "Configs: ${config}";
echo '# Configs' >> $HOME/.bashrc ;
printf "WEBSHIP_WORKSPACE_CONFIG=%s;\n" "$config" >> $HOME/.bashrc ;
printf "export WEBSHIP_WORKSPACE_CONFIG=%s;\n" "$config" >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
# Create the workspace + backups folder layout listed in settings.yml.
echo 'Creating workspace and backups folders';
mkdir -p "${backups}" ;
for workspace_name in "${workspaces[@]}" ; do
  mkdir -p "${root}/${workspace_name}" ;
  mkdir -p "${backups}/${workspace_name}" ;
done

echo '';
echo 'Done. Close all terminal windows and open a new one, then verify with:';
echo '  echo ${WEBSHIP_WORKSPACE_CONFIG}';
