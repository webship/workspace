#!/usr/bin/env bash

# workspace-name: Local (Drupal CMS site template)

# Build and install Drupal CMS with the Local site template.
# drupal/local — https://new.drupal.org/site-template/local

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Site template.
site_template_name="local";
site_template_title="Local";
site_template_package="drupal/local";

# Distribution.
distribution_name="drupal_cms";
distribution_title="Drupal CMS";
distribution_webroot="web";
distribution_profile_repo="drupal/cms";
distribution_project_template="drupal/cms";

ARGPARSE_DESCRIPTION="Build and install a ${distribution_title} site with the Local site template"
source ${WORKSPACE_SCRIPTS}/args/arg-site-template.sh || exit 1 ;

shift $#;

build_site_template ;
