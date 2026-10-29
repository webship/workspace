#!/usr/bin/env bash

# workspace-name: Horizon Aid ^1 (Drupal CMS site template)

# Build a site with the Horizon Aid site template.
# drupal/horizonaid by Vardot, https://www.drupal.org/project/horizonaid
# Ships with its own theme, drupal/vartheme_bs5_horizonaid.
#
# The Drupal CMS installer lists Horizon Aid (drupal_cms_installer's site-templates.yml),
# and downloads the package itself when it is picked. So the default build is the flow the
# project page publishes, a stock drupal/cms with nothing required:
#
#   ddev config --project-type=drupal11 --docroot=web
#   ddev composer create-project drupal/cms
#   ddev launch
#
#   bash cmd-horizonaid-project.sh myproject                          # Drupal CMS, pick it in the browser
#   bash cmd-horizonaid-project.sh myproject --install                # Drupal CMS, installed by drush
#   bash cmd-horizonaid-project.sh myproject --distribution varbase   # Varbase 11
#
# --install and --site-template-version require the package first, since drush cannot
# download it and the installer always takes the latest release.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Site template.
site_template_name="horizonaid";
site_template_title="Horizon Aid";
site_template_package="drupal/horizonaid";

# The major release this command tracks, and what its name says. Stated rather than left
# open: an unconstrained require takes whatever is newest, so the same command would build
# a different major the day one ships. `--site-template-version` overrides it.
site_template_version="^1";
site_template_listed="yes";

# Varbase site version, when building on Varbase.
site_version="11.0.x-dev";

ARGPARSE_DESCRIPTION="Build a site with the ${site_template_title} site template, on Drupal CMS or on Varbase 11"
source ${WORKSPACE_SCRIPTS}/args/arg-vardot-site-template.sh || exit 1 ;

shift $#;

# Distribution: the two bases this Site recipe installs on.
if [ "${DISTRIBUTION}" == 'drupal_cms' ] ; then
  distribution_name="drupal_cms";
  distribution_title="Drupal CMS";
  distribution_webroot="web";
  distribution_profile_repo="drupal/cms";
  distribution_project_template="drupal/cms";
  installer_profile="drupal_cms_installer";
else
  distribution_name="varbase";
  distribution_title="Varbase";
  # Varbase 11's project template ships its docroot as web/.
  distribution_webroot="web";
  distribution_profile_repo="vardot/varbase";
  distribution_project_template="drupal/varbase_project:${site_version}";
  installer_profile="varbase";
fi

SITE_TEMPLATE_VERSION="${SITE_TEMPLATE_VERSION:-${site_template_version}}";

build_site_template ;
