#!/usr/bin/env bash

current_path=$(pwd);
user_name="$USER";

# Where this tooling comes from, and where a proposed change is filed. Captured HERE, before
# settings.yml is parsed: parse_yaml would overwrite an exported override with the file's value,
# and an export is meant to win for a one-off run.
_env_workspace_repo="${WORKSPACE_REPO}";
_env_workspace_repo_ref="${WORKSPACE_REPO_REF}";
_env_ai_items_repo="${AI_ITEMS_REPO}";
_env_ai_items_ref="${AI_ITEMS_REF}";

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

# The tooling repository, from sources.tooling in settings.yml. The commands tooling compares
# against it, pulls from it, and proposes back to it.
WORKSPACE_REPO="${_env_workspace_repo:-${sources_tooling_repo:-webship/workspace}}";
WORKSPACE_REPO_REF="${_env_workspace_repo_ref:-${sources_tooling_ref:-1.0.x}}";

# The shared AI agents, skills and prompts come from their own repository, and go back to it the
# same way commands go back to the tooling one.
AI_ITEMS_REPO="${_env_ai_items_repo:-${sources_ai_items_repo:-webship/ai-agents}}";
AI_ITEMS_REF="${_env_ai_items_ref:-${sources_ai_items_ref:-main}}";
export WORKSPACE_REPO WORKSPACE_REPO_REF AI_ITEMS_REPO AI_ITEMS_REF ;

# The backups folder is the one directory that is not in the checkout.
mkdir -p "${backups}" 2>/dev/null ;
