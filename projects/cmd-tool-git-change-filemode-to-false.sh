#!/bin/usr/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.projects.settings.yml);

for dir_name in *; do
    if [[ -d "$dir_name" && ! -L "$dir_name" ]]; then
        if [ -f "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${dir_name}/.git/config" ]; then
          sed -i -e 's/filemode = true/filemode = false/g' ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${dir_name}/.git/config
        fi
    fi
done
