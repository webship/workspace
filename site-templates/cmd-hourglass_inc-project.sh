#!/usr/bin/env bash

# workspace-name: Hourglass Corporate ^1 (Drupal CMS site template)

# Build and install Drupal CMS with the Hourglass Corporate site template.
# drupal/hourglass_inc — https://new.drupal.org/site-template/hourglass-corporate
#
# A corporate B2B and SaaS site, built with Canvas and Single Directory Components.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Site template.
site_template_name="hourglass_inc";
site_template_title="Hourglass Corporate";
site_template_package="drupal/hourglass_inc";

# The major release this command tracks, and what its name says. Stated rather than left
# open: an unconstrained require takes whatever is newest, so the same command would build
# a different major the day one ships. `--site-template-version` overrides it.
site_template_version="^1";

# Listed in the Drupal CMS installer's own site-templates.yml, so the default build is the
# plain `composer create-project drupal/cms` the project page publishes and the installer
# fetches the recipe when it is picked. --install and an explicit --site-template-version
# still require it, since drush cannot download anything.
site_template_listed="yes";

# Distribution.
distribution_name="drupal_cms";
distribution_title="Drupal CMS";
distribution_webroot="web";
distribution_profile_repo="drupal/cms";
distribution_project_template="drupal/cms";

ARGPARSE_DESCRIPTION="Build and install a ${distribution_title} site with the Hourglass Corporate site template"
source ${WORKSPACE_SCRIPTS}/args/arg-site-template.sh || exit 1 ;

shift $#;

SITE_TEMPLATE_VERSION="${SITE_TEMPLATE_VERSION:-${site_template_version}}";

build_site_template ;
