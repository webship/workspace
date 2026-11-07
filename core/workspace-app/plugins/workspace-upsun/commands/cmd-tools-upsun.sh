#!/usr/bin/env bash

# Installed by the Upsun plugin (plugins.sh --install upsun); __WORKSPACE__ is the workspace it was installed into.
#
# The local ⇄ cloud bridge for one project: show its Upsun link and
# environments, link it (upsun project:set-remote), scaffold its
# .upsun/config.yaml, or deploy the current branch with upsun push.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

ARGPARSE_DESCRIPTION="Show, link or deploy a __WORKSPACE__ project on Upsun"
# The args file comes with the plugin: core/scripts/plugins/upsun/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/upsun/args/arg-upsun.sh || exit 1 ;

shift $#;

upsun_project_tool ;
