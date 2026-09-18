#!/usr/bin/env bash

# workspace-name: Webships Starter 1.0.x (Drupal 11.4.x)

# Build a Drupal 11.4.x recommended project on PHP 8.4 and install it with the
# Webships Starter recipe (drupal/webships_starter 1.0.x-dev), the default API
# site template of the Webships installer.
# https://www.drupal.org/project/webships_starter
#
#   bash cmd-webships_starter-1-0-x-project.sh myapi
#   bash cmd-webships_starter-1-0-x-project.sh myapi --add-users
#
# This builds the recipe on plain Drupal, so there is no installer profile and no
# API documentation asset library: the assets only install from a root project
# package. Use cmd-webships_project-1-0-x-project.sh for the full stack.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Set the site template version.
site_version="1.0.x-dev";

# Site template.
site_template_name="webships_starter";
site_template_title="Webships Starter";
site_template_package="drupal/webships_starter";

# Distribution.
distribution_name="webships";
distribution_title="Drupal";
distribution_webroot="web";
distribution_profile_repo="drupal/core";
distribution_project_template="drupal/recommended-project";

ARGPARSE_DESCRIPTION="Build a Drupal 11.4.x project with the ${site_template_title} ${site_version} recipe"
source ${WORKSPACE_SCRIPTS}/args/arg-webships-site-template.sh || exit 1 ;

shift $#;

build_webships_site_template ;
