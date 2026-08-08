#!/usr/bin/env bash

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

cd ${WORKSPACE_ROOT}/${doc_name};
echo "=======================================================";
echo "  Update all projects in ${WORKSPACE_ROOT}/${doc_name} ";
echo "=======================================================";
for project in *; do
    if [ -d "$project" ]; then
        echo "  $project   ";
    fi;
done;
for project in *; do
    if [ -d "$project" ]; then
        echo "=======================================================";
        echo "  ${WORKSPACE_ROOT}/${doc_name}/${project}/   ";
        echo "=======================================================";
        cd ${WORKSPACE_ROOT}/${doc_name}/${project};
        yes | composer update -v;
    fi;
    cd ${WORKSPACE_ROOT}/${doc_name}
done;