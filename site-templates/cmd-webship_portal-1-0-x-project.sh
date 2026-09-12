#!/usr/bin/env bash

# workspace-name: Webship Portal 1.0.x (Drupal 11.4.x)

# Build a Drupal 11.4.x recommended project on PHP 8.4 and install it with the
# Webship Portal recipe (drupal/webship_portal 1.0.x-dev).
# https://www.drupal.org/project/webship_portal
#
#   bash cmd-webship_portal-1-0-x-project.sh mysite
#   bash cmd-webship_portal-1-0-x-project.sh mysite --with-pending-fixes --add-users

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Set the site template version.
site_version="1.0.x-dev";

# Site template.
site_template_name="webship_portal";
site_template_title="Webship Portal";
site_template_package="drupal/webship_portal";

# Distribution.
distribution_name="website";
distribution_title="Drupal";
distribution_webroot="web";
distribution_profile_repo="drupal/core";
distribution_project_template="drupal/recommended-project";

ARGPARSE_DESCRIPTION="Build a Drupal 11.4.x project with the ${site_template_title} ${site_version} recipe"
source ${WORKSPACE_SCRIPTS}/args/arg-website-site-template.sh || exit 1 ;

shift $#;

build_website_site_template ;
