#!/usr/bin/env bash

# workspace-name: The Rightup 1.0.x-dev on Drupal CMS 2 (site template)

# Build and install a Drupal CMS 2 site with the RightUp site template
# (https://www.drupal.org/project/rightup — the drupal/rightup Site recipe and its drupal/vartheme_bs5_rightup theme).
#
# Base = drupal/cms (plain Drupal CMS 2.x). On Varbase 11, varbase_project
# already carries everything a Vardot Site recipe needs, so
# cmd-rightup1-0-x-project.sh is enough there. A stock Drupal CMS codebase
# carries none of it, and the recipe cannot even be resolved on it: every
# drupal/varbase_*_base it requires is 1.0.x-dev, against drupal/cms's
# `minimum-stability: stable`.
#
# build_site_template_drupalcms adds that wiring before the site template is
# ever resolved — dev stability, the vardot/varbase-patches allowlist so the
# Canvas patches apply, the oomphinc/composer-installers-extender plugin
# drupal/cms blocks, and the two Composer installer paths that place the
# front-end libraries a generic web/libraries/{$name} rule cannot. Each piece is
# explained in its header, in
# core/scripts/functions/fun-build-site-template.sh.
#
#   bash cmd-drupalcms2-x-rightup1-0-x-project.sh myproject
#
# RightUp has no stable release, so 1.0.x-dev is its only line and there is
# no cmd-drupalcms2-x-rightup1-0-0-project.sh. Its project page publishes the
# same `ddev composer config minimum-stability dev` this command applies.
#
# KNOWN LIMIT — the codebase builds green (canvas 1.9.0 with its patches, the
# libraries synced, the recipe placed), but the INSTALL currently fails on a
# plain Drupal CMS base for a reason outside this command: drupal_cms_search
# clones every node view display (`cloneAs: node.%.search_index`) and Drupal
# CMS installs layout_builder, so LayoutBuilderEntityViewDisplay's dependency
# calculation hits a field definition that is null:
#
#   Call to a member function getConfigDependencyName() on null in
#   Drupal\Core\Entity\EntityDisplayBase->calculateDependencies()
#
# Reproduced on two independent templates (Varbase Starter and Educare), so it
# is not a defect in any one site template. Until it is fixed upstream, use
# leaving --install off stops at a working codebase:
#
#   bash cmd-drupalcms2-x-rightup1-0-x-project.sh myproject

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Site template.
site_template_name="rightup";
site_template_title="RightUp";
site_template_package="drupal/rightup";

# The 1.0.x line, matching this command's name. arg-site-template.sh defaults
# --site-template-version to the latest release, so pin it when the caller does
# not pass one.
site_template_version="1.0.x-dev";

# dev, because a 1.0.x-dev site template pulls 1.0.x-dev
# drupal/varbase_*_base packages and none of those resolve against
# drupal/cms's `minimum-stability: stable`. The released builders set
# stable and leave the root stability alone.
site_template_stability="dev";

# Matches drupal/varbase_project's require.vardot/varbase-patches on this line.
varbase_patches_constraint="11.0.x-dev";

ARGPARSE_DESCRIPTION="Build and install a Drupal CMS 2 site with the RightUp ${site_template_version} site template"
source ${WORKSPACE_SCRIPTS}/args/arg-site-template.sh || exit 1 ;

shift $#;

SITE_TEMPLATE_VERSION="${SITE_TEMPLATE_VERSION:-${site_template_version}}";

build_site_template_drupalcms ;
