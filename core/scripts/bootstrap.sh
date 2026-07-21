#!/bin/usr/env bash

current_path=$(pwd);
user_name="$USER";

# Include Bootstrap libraries.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap-libraries.sh || exit 1 ;

# Include Bootstrap functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap-functions.sh || exit 1 ;

# Load settings.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/settings.yml);
