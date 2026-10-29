#!/usr/bin/env bash

# workspace-name: The Rightup 1.0.x-dev on Varbase 11.0.x-dev (site template)

# Build and install a Varbase 11 site with the RightUp site template
# (https://www.drupal.org/project/rightup — the drupal/rightup Site recipe
# and its drupal/vartheme_bs5_rightup theme).
#
# RightUp is chosen in the installer's site-template step. This command
# answers that step non-interactively; --install runs the whole thing:
#
#   bash cmd-rightup1-0-x-project.sh myproject --install
#
# To build the codebase only and pick "RightUp" in the browser installer
# yourself (the path the site template is verified against), leave --install off:
#
#   bash cmd-rightup1-0-x-project.sh myproject

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Set site version.
site_version="11.0.x-dev";

# Site template.
site_template_name="rightup";
site_template_title="RightUp";
site_template_package="drupal/rightup";

# The version this command's name says: `1-0-x` is 1.0.x-dev. Stated rather
# than left to the argparse default, so the two lines read the same way.
site_template_version_default="1.0.x-dev";

# RightUp has no stable release, so 1.0.x-dev is its only line and there is
# no cmd-rightup1-0-0-project.sh.

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
