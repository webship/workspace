#!/bin/usr/env bash

current_path=$(pwd);
user_name="$USER";

# Locate the workspace from this file, so a fresh clone works with no setup:
# core/scripts/bootstrap.sh -> core/scripts -> core -> the workspace root.
# Exported WEBSHIP_WORKSPACE_* variables still win, for a workspace kept
# somewhere other than the checkout that is running.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
WEBSHIP_WORKSPACE_PATH="${WEBSHIP_WORKSPACE_PATH:-$(dirname "${WEBSHIP_WORKSPACE_SCRIPTS}")}";
WEBSHIP_WORKSPACE_ROOT="${WEBSHIP_WORKSPACE_ROOT:-$(dirname "${WEBSHIP_WORKSPACE_PATH}")}";
WEBSHIP_WORKSPACE_CONFIG="${WEBSHIP_WORKSPACE_CONFIG:-${WEBSHIP_WORKSPACE_PATH}/config}";
export WEBSHIP_WORKSPACE_ROOT WEBSHIP_WORKSPACE_PATH WEBSHIP_WORKSPACE_SCRIPTS WEBSHIP_WORKSPACE_CONFIG ;

# Include Bootstrap libraries.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap-libraries.sh || exit 1 ;

# Include Bootstrap functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap-functions.sh || exit 1 ;

# Load settings.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/settings.yml);

# settings.yml carries no paths: they follow the checkout, for whoever is running
# it. Set root/path/scripts/config/backups there only to override that.
root="${root:-${WEBSHIP_WORKSPACE_ROOT}}";
path="${path:-${WEBSHIP_WORKSPACE_PATH}}";
scripts="${scripts:-${WEBSHIP_WORKSPACE_SCRIPTS}}";
config="${config:-${WEBSHIP_WORKSPACE_CONFIG}}";
backups="${backups:-${root}/backups}";

# The backups folder is the one directory that is not in the checkout.
mkdir -p "${backups}" 2>/dev/null ;
