#!/usr/bin/env bash

# workspace-name: Healthcare (Drupal CMS site template)

# Build and install Drupal CMS with the Healthcare site template.
# drupal/healthcare — https://new.drupal.org/site-template/healthcare

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Site template.
site_template_name="healthcare";
site_template_title="Healthcare";
site_template_package="drupal/healthcare";

# Distribution.
distribution_name="drupal_cms";
distribution_title="Drupal CMS";
distribution_webroot="web";
distribution_profile_repo="drupal/cms";
distribution_project_template="drupal/cms";

ARGPARSE_DESCRIPTION="Build and install a ${distribution_title} site with the Healthcare site template"
source ${WORKSPACE_SCRIPTS}/args/arg-site-template.sh || exit 1 ;

shift $#;

build_site_template ;
