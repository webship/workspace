#!/usr/bin/env bash

# workspace-name: WordPress on Composer (Bedrock ^1)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set site version.
site_version="^1";
wordpress_shape="bedrock";
ARGPARSE_DESCRIPTION="Build a WordPress project managed by Composer, on roots/bedrock"
source ${WORKSPACE_SCRIPTS}/args/arg-wordpress.sh || exit 1 ;

shift $#;

build_wordpress ;
