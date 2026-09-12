#!/usr/bin/env bash

# workspace-name: Website 1.0.x (Webship installer)

# Build the Website project template (drupal/website 1.0.x-dev) on Drupal 11.4 and
# PHP 8.4, and install it with the Webship installer and one site template.
# https://www.drupal.org/project/website
#
#   bash cmd-website-1-0-x-project.sh mysite
#   bash cmd-website-1-0-x-project.sh mysite --template webship_starter
#   bash cmd-website-1-0-x-project.sh mysite --template webship_portal --with-pending-fixes

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Set the version.
site_version="1.0.x-dev";

# Distribution.
distribution_name="website";
distribution_title="Website";
distribution_webroot="web";
distribution_profile_repo="drupal/webship";
distribution_project_template="drupal/website";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project, installed with the Webship installer"
source ${WORKSPACE_SCRIPTS}/args/arg-website.sh || exit 1 ;

shift $#;

build_website_project ;
