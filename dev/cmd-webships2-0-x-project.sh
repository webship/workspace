#!/bin/usr/env bash

# workspace-name: Webships 2.0.x

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set the version.
site_version="2.0.x-dev";

# Load distribution configs.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/distributions/webships.yml);

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WEBSHIP_WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
