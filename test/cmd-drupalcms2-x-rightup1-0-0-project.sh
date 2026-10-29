#!/usr/bin/env bash

# workspace-name: The Rightup ~1.0.0 on Drupal CMS 2 (site template)

# Build a Drupal CMS 2 site with the The Rightup site template
# (https://www.drupal.org/project/rightup, the drupal/rightup Site recipe and its drupal/vartheme_bs5_rightup theme).
#
# The RELEASED line. The Drupal CMS installer lists The Rightup and downloads
# drupal/rightup itself when it is picked, so the default build is exactly the flow the
# project page publishes, a stock drupal/cms with nothing required and nothing wired:
#
#   ddev config --project-type=drupal11 --docroot=web
#   ddev composer create-project drupal/cms
#   ddev launch
#
#   bash cmd-drupalcms2-x-rightup1-0-0-project.sh myproject             # pick it in the browser
#   bash cmd-drupalcms2-x-rightup1-0-0-project.sh myproject --install   # installed by drush
#
# --install, or an explicit --site-template-version, requires drupal/rightup ~1.0.0 first,
# because drush cannot download it. That path also adds what a Vardot recipe needs on a
# stock drupal/cms and the installer leaves implicit: the vardot/varbase-patches
# allowlist so the Canvas patches apply, the oomphinc/composer-installers-extender
# plugin drupal/cms blocks, patch resolution as default-deny (drupal/ai_context declares
# a patch by a path relative to the project root), and recipe unpacking turned off.
# Each piece is explained in core/scripts/functions/fun-build-site-template.sh. The
# root minimum-stability is left as drupal/cms ships it, since ~1.0.0 resolves on stable.
#
# cmd-drupalcms2-x-rightup1-0-x-project.sh is the development line. It always requires
# 1.0.x-dev, because the installer only offers the released package, and loosens the
# root stability first:
#
#   ddev composer config minimum-stability dev
#   ddev composer require drupal/rightup:1.0.x-dev
#
# On Varbase 11, see cmd-rightup1-0-x-project.sh.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Site template.
site_template_name="rightup";
site_template_title="The Rightup";
site_template_package="drupal/rightup";

# Listed in the Drupal CMS installer, which fetches it when it is picked.
site_template_listed="yes";

# The released line, matching this command's name: `1-0-0` is ~1.0.0 — the three-segment
# form, so the constraint means "the 1.0 line, latest patch" rather than the whole major
# (`~1` would resolve up to 1.x). `1-0-x` is 1.0.x-dev, the same convention the Varbase
# and Drupal builders use.
site_template_version="~1.0.0";

# stable, so the root's minimum-stability is never touched. This is the
# difference between the two lines.
site_template_stability="stable";

# Matches drupal/varbase_project's require.vardot/varbase-patches on this line.
varbase_patches_constraint="~11.0.0";

ARGPARSE_DESCRIPTION="Build a Drupal CMS 2 site with the The Rightup ${site_template_version} site template"
source ${WORKSPACE_SCRIPTS}/args/arg-site-template.sh || exit 1 ;

shift $#;

SITE_TEMPLATE_VERSION="${SITE_TEMPLATE_VERSION:-${site_template_version}}";

build_site_template_drupalcms ;
