#!/usr/bin/env bash

# workspace-name: Website 12.0.x

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Set the version.
site_version="12.0.x-dev";

# Distribution.
distribution_name="website";
distribution_title="Website";
distribution_webroot="web";
distribution_profile_repo="drupal/webship";
distribution_project_template="drupal/website";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the Website project: the Webship installer installs it with --template.
build_website_project ;
