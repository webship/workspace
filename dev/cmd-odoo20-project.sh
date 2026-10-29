#!/usr/bin/env bash

# workspace-name: Odoo 20 Community

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set site version.
site_version="20.0";

ARGPARSE_DESCRIPTION="Build an Odoo Community project, on PostgreSQL"
source ${WORKSPACE_SCRIPTS}/args/arg-odoo.sh || exit 1 ;

shift $#;

build_odoo ;
