#!/usr/bin/env bash

# workspace-name: Webships 2.0.0

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.sandboxes.settings.yml);

# Set the version.
site_version="~2.0";

# Distribution.
distribution_name="webships";
distribution_title="Webships";
distribution_webroot="web";
distribution_profile_repo="webship/webships";
distribution_project_template="webship/webships-project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
