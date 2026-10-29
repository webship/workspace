#!/usr/bin/env bash

# workspace-name: WordPress (latest)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set site version.
site_version="latest";
wordpress_shape="core";
ARGPARSE_DESCRIPTION="Build a WordPress project, the latest release"
source ${WORKSPACE_SCRIPTS}/args/arg-wordpress.sh || exit 1 ;

shift $#;

build_wordpress ;
