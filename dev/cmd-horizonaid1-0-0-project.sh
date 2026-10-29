#!/usr/bin/env bash

# workspace-name: Horizon Aid ~1.0.0 on Varbase ~11 (site template)

# Build and install a Varbase 11 site with the Horizon Aid site template
# (https://www.drupal.org/project/horizonaid — the drupal/horizonaid Site recipe
# and its drupal/vartheme_bs5_horizonaid theme).
#
# Horizon Aid is chosen in the installer's site-template step. This command
# answers that step non-interactively; --install runs the whole thing:
#
#   bash cmd-horizonaid1-0-0-project.sh myproject --install
#
# To build the codebase only and pick "Horizon Aid" in the browser installer
# yourself (the path the site template is verified against), leave --install off:
#
#   bash cmd-horizonaid1-0-0-project.sh myproject

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

# Set site version. Released Varbase 11, not the branch -- a released site
# template on a dev base would not be the combination anyone installs.
site_version="~11";

# Site template.
site_template_name="horizonaid";
site_template_title="Horizon Aid";
site_template_package="drupal/horizonaid";

# The released line, and the sequence published on
# https://www.drupal.org/project/horizonaid:
#
#   ddev config --project-type=drupal11 --docroot=web --php-version=8.4
#   ddev start
#   ddev composer create-project "drupal/varbase_project:~11"
#   ddev composer require drupal/horizonaid:~1.0.0
#
# `1-0-0` in the filename is ~1.0.0 — the three-segment form, so it means "the 1.0 line,
# latest patch" rather than the whole major (`~1` would resolve up to 1.x). `1-0-x` is
# 1.0.x-dev, the same convention the Varbase and Drupal builders use.
site_template_version_default="~1.0.0";

# Distribution.
distribution_name="varbase";
distribution_title="Varbase";
# Varbase 11's project template ships its docroot as web/.
distribution_webroot="web";
distribution_profile_repo="vardot/varbase";
distribution_project_template="drupal/varbase_project:${site_version}";

# Varbase asks the site-template question from its own profile, with the same
# installer_site_template_form.add_ons element Drupal CMS uses.
installer_profile="varbase";

ARGPARSE_DESCRIPTION="Build and install a ${distribution_title} ${site_version} site with the ${site_template_title} site template"
source ${WORKSPACE_SCRIPTS}/args/arg-varbase-site-template.sh || exit 1 ;

shift $#;

build_site_template ;
