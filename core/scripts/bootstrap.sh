#!/bin/usr/env bash

current_path=$(pwd);
user_name="$USER";

# These were WEBSHIP_WORKSPACE_* until the rename. Anyone still exporting the old names meant them
# as an override, so honour them rather than silently ignoring the override and picking the
# checkout instead.
WORKSPACE_ROOT="${WORKSPACE_ROOT:-${WEBSHIP_WORKSPACE_ROOT}}";
WORKSPACE_PATH="${WORKSPACE_PATH:-${WEBSHIP_WORKSPACE_PATH}}";
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-${WEBSHIP_WORKSPACE_SCRIPTS}}";
WORKSPACE_CONFIG="${WORKSPACE_CONFIG:-${WEBSHIP_WORKSPACE_CONFIG}}";

# Locate the workspace from this file, so a fresh clone works with no setup:
# core/scripts/bootstrap.sh -> core/scripts -> core -> the workspace root.
# Exported WORKSPACE_* variables still win, for a workspace kept
# somewhere other than the checkout that is running.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
WORKSPACE_PATH="${WORKSPACE_PATH:-$(dirname "${WORKSPACE_SCRIPTS}")}";
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(dirname "${WORKSPACE_PATH}")}";
WORKSPACE_CONFIG="${WORKSPACE_CONFIG:-${WORKSPACE_PATH}/config}";
export WORKSPACE_ROOT WORKSPACE_PATH WORKSPACE_SCRIPTS WORKSPACE_CONFIG ;

# Include Bootstrap libraries.
source ${WORKSPACE_SCRIPTS}/bootstrap-libraries.sh || exit 1 ;

# Include Bootstrap functions.
source ${WORKSPACE_SCRIPTS}/bootstrap-functions.sh || exit 1 ;

# Load settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/settings.yml);

# settings.yml carries no paths: they follow the checkout, for whoever is running
# it. Set root/path/scripts/config/backups there only to override that.
root="${root:-${WORKSPACE_ROOT}}";
path="${path:-${WORKSPACE_PATH}}";
scripts="${scripts:-${WORKSPACE_SCRIPTS}}";
config="${config:-${WORKSPACE_CONFIG}}";
backups="${backups:-${root}/backups}";

# The backups folder is the one directory that is not in the checkout.
mkdir -p "${backups}" 2>/dev/null ;
