#!/bin/usr/env bash

# workspace-name: Webship 11.0.0

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set the version.
site_version="~11.0";

# Load distribution configs.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/distributions/webship.yml);

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WEBSHIP_WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
