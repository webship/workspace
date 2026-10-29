#!/usr/bin/env bash

current_path=$(pwd);
user_name="$USER";

# What the environment asked for, captured before the function files get a chance to default
# it. bootstrap-functions.sh is sourced BEFORE settings.yml is parsed, so a top-level default
# in one of those files would otherwise always beat the setting.
_env_workspace_repo="${WORKSPACE_REPO}";
_env_workspace_repo_ref="${WORKSPACE_REPO_REF}";
_env_ai_items_repo="${AI_ITEMS_REPO}";
_env_ai_items_ref="${AI_ITEMS_REF}";

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

# Where a sync pulls from. Precedence: the environment, then settings.yml's `sources:`, then
# the Vardot defaults — so a fork or another host is one settings edit, and a one-off run is
# still an env var.
WORKSPACE_REPO="${_env_workspace_repo:-${sources_tooling_repo:-webship/workspace}}";
WORKSPACE_REPO_REF="${_env_workspace_repo_ref:-${sources_tooling_ref:-1.0.x}}";
AI_ITEMS_REPO="${_env_ai_items_repo:-${sources_ai_items_repo:-Vardot/dev-ai-agents}}";
AI_ITEMS_REF="${_env_ai_items_ref:-${sources_ai_items_ref:-main}}";
export WORKSPACE_REPO WORKSPACE_REPO_REF AI_ITEMS_REPO AI_ITEMS_REF ;
unset _env_workspace_repo _env_workspace_repo_ref _env_ai_items_repo _env_ai_items_ref ;

# settings.yml carries no paths: they follow the checkout, for whoever is running
# it. Set root/path/scripts/config/backups there only to override that.
root="${root:-${WORKSPACE_ROOT}}";
path="${path:-${WORKSPACE_PATH}}";
scripts="${scripts:-${WORKSPACE_SCRIPTS}}";
config="${config:-${WORKSPACE_CONFIG}}";
backups="${backups:-${root}/backups}";

# The backups folder is the one directory that is not in the checkout.
mkdir -p "${backups}" 2>/dev/null ;
