#!/bin/usr/env bash

# workspace-name: Drupal 11.4.0 (recommended project)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.demos.settings.yml);

# Set site version.
site_version="~11.4.0";

# Distribution.
distribution_name="drupal";
distribution_title="Drupal";
distribution_webroot="web";
distribution_profile_repo="drupal/core";
distribution_project_template="drupal/recommended-project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WEBSHIP_WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
