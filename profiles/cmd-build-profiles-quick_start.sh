#!/usr/bin/env bash

# workspace-name: Quick Start

echo "*---------------------------------------------------*";
echo "| Build Quick Start                                 |";
echo "*---------------------------------------------------*";
echo "| https://www.drupal.org/project/quick_start        |";
echo "*---------------------------------------------------*";

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.profiles.settings.yml);
if [ -d "${WORKSPACE_ROOT}/${doc_name}/quick_start" ]; then
  (cd "${WORKSPACE_ROOT}/${doc_name}/quick_start" && ddev delete -y -O 2>/dev/null) ;
  rm -rf "${WORKSPACE_ROOT}/${doc_name}/quick_start" ;
fi

mkdir -p "${WORKSPACE_ROOT}/${doc_name}/quick_start" ;
cd "${WORKSPACE_ROOT}/${doc_name}/quick_start" ;

ddev config --project-type=drupal --docroot=web --project-name=quick_start --auto ;
ddev start ;

ddev composer create-project drupalcoders/quick_start_distribution:dev-master . --no-dev --no-interaction --prefer-dist;