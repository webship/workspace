#!/bin/usr/env bash

# workspace-name: Webship 11.0.0

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.demos.settings.yml);

# Set the version.
site_version="~11.0";

# Distribution.
distribution_name="webship";
distribution_title="Webship";
distribution_webroot="web";
distribution_profile_repo="drupal/webship";
distribution_project_template="drupal/webship_project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WEBSHIP_WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
