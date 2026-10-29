#!/usr/bin/env bash

# workspace-name: Drupal 12 (latest)

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set site version.
site_version="^12";
site_version_dev="12.x-dev";
# Drupal 12 has no stable release yet, so the caret constraint above matches only a
# pre-release and composer's default `stable` minimum would resolve to nothing. This is
# the floor this builder accepts; composer still takes the highest match, so 12.0.0 wins
# the day it lands and this line can simply go.
site_version_stability="alpha";
# drupal/core 12 requires php >= 8.5.0, and DDEV's default is 8.4.
site_php_version="8.5";
# Core 12 requires guzzle 8. Every TAGGED Drush requires guzzle ^7 — 14.x is the first
# branch to allow 8 and it has no release yet, so the development branch is the only
# Drush that can sit beside Drupal 12 today. Swap this for `^14` when 14.0.0 is tagged.
site_drush_version="14.x-dev";

# Distribution.
distribution_name="drupal";
distribution_title="Drupal";
distribution_webroot="web";
distribution_profile_repo="drupal/core";
distribution_project_template="drupal/recommended-project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project"
source ${WORKSPACE_SCRIPTS}/args/arg-${distribution_name}.sh || exit 1 ;

shift $#;

# Build the distribution.
build_distribution ;
