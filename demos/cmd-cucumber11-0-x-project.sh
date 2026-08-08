#!/usr/bin/env bash

# workspace-name: Cucumber 11.0.x

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.demos.settings.yml);

# Set the version.
site_version="11.0.x-dev";

# Distribution.
distribution_name="cucumber";
distribution_title="Cucumber";
distribution_webroot="web";
distribution_profile_repo="webship/cucumber";
distribution_project_template="webship/cucumber-project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
