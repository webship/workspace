#!/usr/bin/env bash

# workspace-name: Webships 3.0.x

# Build a Webships 3.0.x API site with DDEV: the Webships Project template, the
# Webships installer, and one API site template.
# https://www.drupal.org/project/webships
#
#   bash cmd-webships3-0-x-project.sh myapi --install
#   bash cmd-webships3-0-x-project.sh myapi --install --template webapi_starter --add-users
#
# The installer profile is on 3.0.x while the project template is on 1.0.x: the two
# lines are deliberately not in lockstep, so `site_version` below is the version of
# the PROJECT TEMPLATE, which is what `composer create-project` receives. The 3.0.x
# profile arrives through the template's own `webship/webships: ^3` constraint.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Set the version of the project template.
site_version="1.0.x-dev";

# Distribution.
distribution_name="webships";
distribution_title="Webships";
distribution_webroot="web";
distribution_profile_repo="webship/webships";
distribution_project_template="drupal/webships_project";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} 3.0.x API project, installed with the Webships installer"
source ${WORKSPACE_SCRIPTS}/args/arg-webships-project.sh || exit 1 ;

shift $#;

build_webships_project ;
