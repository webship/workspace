#!/usr/bin/env bash

# workspace-name: Webship 11.0.0

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set the version.
# The 11.0.0 line. Named down to the release candidate on purpose: rc1 is the only
# release published so far, and a constraint of "~11.0" cannot select it under stable
# stability — create-project fails outright. This picks up 11.0.0 as soon as it is tagged.
site_version="~11.0.0-rc1";

# Distribution.
distribution_name="webship";
distribution_title="Webship";
distribution_webroot="web";
distribution_profile_repo="drupal/webship";
distribution_project_template="drupal/webship_project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
