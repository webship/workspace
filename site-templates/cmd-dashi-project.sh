#!/usr/bin/env bash

# workspace-name: Dashi ^1 (Drupal CMS site template)

# Build and install Drupal CMS with the Dashi site template.
# drupal/dashi — https://new.drupal.org/site-template/dashi
#
# Umami's recipes carried forward for Drupal CMS, in English and Spanish, rebuilt on the Canvas page builder.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Site template.
site_template_name="dashi";
site_template_title="Dashi";
site_template_package="drupal/dashi";

# The major release this command tracks, and what its name says. Stated rather than left
# open: an unconstrained require takes whatever is newest, so the same command would build
# a different major the day one ships. `--site-template-version` overrides it.
site_template_version="^1";

# NOT in the Drupal CMS installer's curated list, so there is nothing to pick in the browser:
# the package is always required first, on every path.

# Distribution.
distribution_name="drupal_cms";
distribution_title="Drupal CMS";
distribution_webroot="web";
distribution_profile_repo="drupal/cms";
distribution_project_template="drupal/cms";

ARGPARSE_DESCRIPTION="Build and install a ${distribution_title} site with the Dashi site template"
source ${WORKSPACE_SCRIPTS}/args/arg-site-template.sh || exit 1 ;

shift $#;

SITE_TEMPLATE_VERSION="${SITE_TEMPLATE_VERSION:-${site_template_version}}";

build_site_template ;
