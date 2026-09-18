#!/usr/bin/env bash

# workspace-name: Webships Project 1.0.x (Webships installer)

# Build the Webships Project template (drupal/webships_project 1.0.x-dev) on
# Drupal 11.4 and PHP 8.4, and install it with the Webships installer and one
# API site template.
# https://www.drupal.org/project/webships_project
#
#   bash cmd-webships_project-1-0-x-project.sh myapi
#   bash cmd-webships_project-1-0-x-project.sh myapi --template webapi_starter
#   bash cmd-webships_project-1-0-x-project.sh myapi --template webships_starter --add-users
#
# The installer profile is on 3.0.x while this project template is on 1.0.x: the
# two lines are deliberately not in lockstep. `site_version` is the version of
# the PROJECT TEMPLATE, because that is what `composer create-project` receives;
# the profile arrives through the template's own `webship/webships: ^3`.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Set the version of the project template.
site_version="1.0.x-dev";

# Distribution.
distribution_name="webships";
distribution_title="Webships Project";
distribution_webroot="web";
distribution_profile_repo="webship/webships";
distribution_project_template="drupal/webships_project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project, installed with the Webships installer"
source ${WORKSPACE_SCRIPTS}/args/arg-webships-project.sh || exit 1 ;

shift $#;

build_webships_project ;
