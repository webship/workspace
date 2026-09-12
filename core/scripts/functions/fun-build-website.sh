#!/usr/bin/env bash

# Build the Website stack (Drupal 11.4, PHP 8.4):
#
#   build_website_project        drupal/website, installed by the Webship installer
#                                (`drush site:install webship`) with the chosen site template.
#   build_website_site_template  one site-template recipe on drupal/recommended-project 11.4.x,
#                                installed with `drush site:install <recipe directory>`.
#
# The calling cmd-*.sh sets distribution_* and site_version, and for a recipe build
# site_template_name, site_template_title and site_template_package.

website_php_version="8.4";
website_core_version="11.4.x-dev";

# A clean DDEV project for PROJECT_NAME in this workspace, with the codebase of
# `$1` (a composer project template with its version) in it.
function website_create_project() {
  base_url="https://${PROJECT_NAME}.ddev.site";

  cd ${WORKSPACE_ROOT}/${doc_name};
  drop_database;
  if [ -d "${PROJECT_NAME}" ]; then
    rm -rf ${PROJECT_NAME}
  fi
  mkdir -p ${PROJECT_NAME} ;
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

  ddev config --project-type=drupal --docroot=${distribution_webroot} --php-version=${website_php_version} --project-name=${PROJECT_NAME} --auto ;
  ddev start -y ;

  if ! ddev composer create-project "$1" . --no-interaction ; then
    echo "composer create-project failed for $1 — aborting, nothing was installed." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  # The web* packages and the site templates only have dev releases for now.
  ddev composer config minimum-stability dev ;
  ddev composer config prefer-stable true ;

  # Keep the site templates as recipes, like drupal/website does: unpacking them
  # into the root composer.json fails on aliased dev branches (the pending fixes).
  ddev composer config --json --merge extra.drupal-recipe-unpack.ignore '["drupal/website_starter", "drupal/webship_starter", "drupal/webship_portal"]' ;
}

# -----------------------------------------------------------------------------
# @todo Remove this block (and --with-pending-fixes) once these are merged into
#   12.0.x — the builds work without the flag from then on:
#   - webblog MR !4:     https://git.drupalcode.org/project/webblog/-/merge_requests/4
#   - webreleases MR !5: https://git.drupalcode.org/project/webreleases/-/merge_requests/5
#
# Pins the issue-fork branches with --with-pending-fixes. `composer config
# repositories.<name>` adds a repository ahead of packages.drupal.org, so the
# fork wins. Arguments: the pins to add — webblog, webreleases.
function website_add_pending_fixes() {
  if [ ! "${WITH_PENDING_FIXES}" == 'yes' ] ; then
    return 0 ;
  fi

  local pins=() ;
  for fix in "$@" ; do
    case "${fix}" in
      webship)
        # drupal/webship has no 12.0.x-dev on packages.drupal.org yet
        # ("Package drupal/webship not found"): take the installer from its 12.0.x branch.
        # The repository's default branch (11.0.x) names the package webship/webship,
        # and a vcs repository takes its package name from the default branch.
        echo "Pending fix: webship/webship (the Webship installer) from its 12.0.x branch." ;
        ddev composer config repositories.webship-12 vcs https://git.drupalcode.org/project/webship.git ;
        pins+=("webship/webship:12.0.x-dev") ;
        ;;
      webblog)
        echo "Pending fix: webblog from issue/webblog-3591554 (3591554-display-builder)." ;
        ddev composer config repositories.webblog-3591554 vcs https://git.drupalcode.org/issue/webblog-3591554.git ;
        pins+=("drupal/webblog:dev-3591554-display-builder as 12.0.x-dev") ;
        ;;
      webreleases)
        echo "Pending fix: webreleases from issue/webreleases-3591672 (3591672-display-builder)." ;
        ddev composer config repositories.webreleases-3591672 vcs https://git.drupalcode.org/issue/webreleases-3591672.git ;
        pins+=("drupal/webreleases:dev-3591672-display-builder as 12.0.x-dev") ;
        ;;
    esac
  done

  if [ ${#pins[@]} -gt 0 ] ; then
    ddev composer require --no-update "${pins[@]}" ;
  fi
}
# -----------------------------------------------------------------------------

# The pending fixes a site template needs: webship_starter and webship_portal
# bring webreleases on top of the Website Starter's webblog.
function website_pending_fixes_for() {
  case "$1" in
    webship_starter|webship_portal) echo "webblog webreleases" ;;
    *) echo "webblog" ;;
  esac
}

# Install the site, then the shared after-install steps.
function website_after_install() {
  drush_set_debug_on;
  drush_cr;

  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_users ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  ${PROJECT_NAME} is ready: ${base_url}";
  echo "*---------------------------------------------------------------------*";

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# drupal/website installed by the Webship installer with --template.
function build_website_project() {
  local template="${TEMPLATE:-website_starter}" ;

  website_create_project "${distribution_project_template}:${site_version}" || return 1 ;

  # The Website project requires the Webship installer and the three site
  # templates. Add whatever the published template does not require yet.
  local require_block missing=() ;
  require_block=$(sed -n '/"require": {/,/}/p' composer.json) ;
  for package in "drupal/webship:12.0.x-dev" "drupal/website_starter:1.0.x-dev" "drupal/webship_starter:1.0.x-dev" "drupal/webship_portal:1.0.x-dev" ; do
    # The installer is drupal/webship or webship/webship; the pending fixes pin the latter.
    if [ "${package%%:*}" == "drupal/webship" ] && { [ "${WITH_PENDING_FIXES}" == 'yes' ] || echo "${require_block}" | grep -q '"webship/webship"' ; } ; then
      continue ;
    fi
    if ! echo "${require_block}" | grep -q "\"${package%%:*}\"" ; then
      echo "${distribution_project_template} does not require ${package%%:*} yet — adding it." ;
      missing+=("${package}") ;
    fi
  done

  # The codebase carries all three site templates, so it needs every pending fix.
  website_add_pending_fixes webship $(website_pending_fixes_for webship_portal) ;

  # Stage everything, then one full update, so no pin is held back by the lock file.
  local composer_ok=1 ;
  if [ ${#missing[@]} -gt 0 ] ; then
    ddev composer require --no-update --no-interaction "${missing[@]}" || composer_ok=0 ;
  fi
  if [ ${composer_ok} -eq 1 ] && { [ ${#missing[@]} -gt 0 ] || [ "${WITH_PENDING_FIXES}" == 'yes' ] ; } ; then
    ddev composer update -W --no-interaction || composer_ok=0 ;
  fi
  if [ ${composer_ok} -eq 0 ] ; then
    echo "composer failed — aborting before the install." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  set_default_settings ;

  echo "Install ${distribution_title} with the Webship installer and the ${template} site template.";
  if ! ddev drush site:install webship --yes \
    installer_site_template_form.add_ons=${template} \
    --site-name="${distribution_title}" \
    --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" \
    --locale="en" ; then
    echo "" ;
    echo "The ${template} install failed — read the error above. The codebase is kept: ${base_url}/core/install.php" ;
    cd ${WORKSPACE_ROOT}/${doc_name} ;
    return 1 ;
  fi

  website_after_install ;
}

# One site-template recipe on a plain Drupal 11.4.x recommended project.
function build_website_site_template() {
  website_create_project "drupal/recommended-project:${website_core_version}" || return 1 ;

  website_add_pending_fixes $(website_pending_fixes_for ${site_template_name}) ;

  if ! ddev composer require -W --no-interaction "drush/drush:^13" "${site_template_package}:${site_version}" ; then
    echo "composer require ${site_template_package}:${site_version} failed — aborting before the install." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  set_default_settings ;

  echo "Install Drupal ${website_core_version} with the ${site_template_title} recipe.";
  if ! ddev drush site:install /var/www/html/recipes/${site_template_name} --yes \
    --site-name="${site_template_title}" \
    --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" \
    --locale="en" ; then
    echo "" ;
    echo "The ${site_template_title} install failed — read the error above." ;
    cd ${WORKSPACE_ROOT}/${doc_name} ;
    return 1 ;
  fi

  website_after_install ;
}
