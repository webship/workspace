#!/bin/usr/env bash

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.sandboxes.settings.yml);

cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name};
echo "=======================================================";
echo "  Update all projects in ${WEBSHIP_WORKSPACE_ROOT}/${doc_name} ";
echo "=======================================================";
for project in *; do
    if [ -d "$project" ]; then
        echo "  $project   ";
    fi;
done;
for project in *; do
    if [ -d "$project" ]; then
        echo "=======================================================";
        echo "  ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${project}/   ";
        echo "=======================================================";
        cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${project};
        yes | composer update -v;
    fi;
    cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}
done;