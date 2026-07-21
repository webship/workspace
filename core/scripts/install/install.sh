#!/bin/usr/env bash

current_path=$(pwd);
user_name="$USER";

# Include Bash YAML library.
. ../libs/bash-yaml.sh

# Include Bash Progress Bar library.
. ../libs/progress-bar.sh

# Load settings.
eval $(parse_yaml ../../config/settings.yml);


echo '*--------------------------------------------------*';
echo '*   Install default configs                         *';
echo '*--------------------------------------------------*';

echo ' ' >> $HOME/.bashrc ;
echo '# *--------------------------------------------------*' >> $HOME/.bashrc ;
echo '# *  Default configs                                 *' >> $HOME/.bashrc ;
echo '# *--------------------------------------------------*' >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
echo 'Root working directory';
echo '# Root working directory'>> $HOME/.bashrc ;

echo "${WEBSHIP_WORKSPACE_ROOT}";
root=${WEBSHIP_WORKSPACE_ROOT};
export root=${WEBSHIP_WORKSPACE_ROOT} ;

printf "root="%s";\n" "$WEBSHIP_WORKSPACE_ROOT" >> $HOME/.bashrc  ;
printf "export root="%s";\n" "$WEBSHIP_WORKSPACE_ROOT" >> $HOME/.bashrc  ;

# ------------------------------------------------------------------------------
echo 'Path where we keep all Configs and scripts';
echo '# Path where we keep all Configs and scripts'>> $HOME/.bashrc ;
echo "${WEBSHIP_WORKSPACE_PATH}" ;
path=${WEBSHIP_WORKSPACE_PATH} ;
export path=${WEBSHIP_WORKSPACE_PATH} ;
printf "path="%s";\n" "$WEBSHIP_WORKSPACE_PATH" >> $HOME/.bashrc ;
printf "export path="%s";\n" "$WEBSHIP_WORKSPACE_PATH" >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
echo 'Scripts';
echo '# Scripts'>> $HOME/.bashrc ;
echo "${WEBSHIP_WORKSPACE_SCRIPTS}" ;
scripts=${WEBSHIP_WORKSPACE_SCRIPTS} ;
export scripts=${WEBSHIP_WORKSPACE_SCRIPTS} ;
printf "scripts="%s";\n" "$WEBSHIP_WORKSPACE_SCRIPTS" >> $HOME/.bashrc ;
printf "export scripts="%s";\n" "$WEBSHIP_WORKSPACE_SCRIPTS" >> $HOME/.bashrc ;

# ------------------------------------------------------------------------------
echo 'Configs';
echo '# Configs'>> $HOME/.bashrc ;
echo "${WEBSHIP_WORKSPACE_CONFIG}" ;
config=${WEBSHIP_WORKSPACE_CONFIG} ;
export config=${WEBSHIP_WORKSPACE_CONFIG} ;
printf "config="%s";\n" "$WEBSHIP_WORKSPACE_CONFIG" >> $HOME/.bashrc ;
printf "export config="%s";\n" "$WEBSHIP_WORKSPACE_CONFIG" >> $HOME/.bashrc ;
