#!/usr/bin/env bash

# workspace-name: Website Starter (Webship site template)

# Build and install Drupal CMS with the Website Starter site template.
# drupal/website_starter — https://www.drupal.org/project/website_starter
#
# The reference site template for this workspace: the one to copy when starting a
# new one, and the one to check a change against.
#
# NOTE: at the time this builder was written the drupal.org project existed but had
# published no release and carried no branch, so `composer require drupal/website_starter`
# has nothing to resolve and the build stops at that step with composer's own message.
# Once a branch is tagged, either take the default (latest release) or name one:
#
#   bash cmd-website_starter-project.sh mysite
#   bash cmd-website_starter-project.sh mysite --site-template-version "1.0.x-dev"
#
# Add --skip-install to stop at a codebase and pick "Website Starter" in the browser
# installer's site-template step yourself.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

# Site template.
site_template_name="website_starter";
site_template_title="Website Starter";
site_template_package="drupal/website_starter";

# Distribution.
distribution_name="drupal_cms";
distribution_title="Drupal CMS";
distribution_webroot="web";
distribution_profile_repo="drupal/cms";
distribution_project_template="drupal/cms";

ARGPARSE_DESCRIPTION="Build and install a ${distribution_title} site with the ${site_template_title} site template"
source ${WORKSPACE_SCRIPTS}/args/arg-site-template.sh || exit 1 ;

shift $#;

build_site_template ;
