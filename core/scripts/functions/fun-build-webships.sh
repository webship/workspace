#!/usr/bin/env bash

# Build the Webships API stack (Drupal 11.4, PHP 8.4):
#
#   build_webships_project        drupal/webships_project, installed by the Webships
#                                 installer (`drush site:install webships`) with the
#                                 chosen API site template.
#   build_webships_site_template  one API site-template recipe on
#                                 drupal/recommended-project 11.4.x, installed with
#                                 `drush site:install <recipe directory>`.
#
# The calling cmd-*.sh sets distribution_* and site_version, and for a recipe build
# site_template_name, site_template_title and site_template_package.
#
# Two things differ from the website stack and are easy to get wrong:
#
#  1. The installer profile is on 3.0.x while the project template is on 1.0.x. The
#     version a builder sets is the PROJECT TEMPLATE's, because that is what
#     `composer create-project` receives. The profile comes in through the template's
#     own `webship/webships: ^3` constraint.
#  2. The API documentation asset library only installs from a root project package,
#     so it is the project template's job. A recipe build has no Swagger assets, and
#     that is expected rather than a fault.

webships_php_version="8.4";
webships_core_version="11.4.x-dev";

# A clean DDEV project for PROJECT_NAME in this workspace, with the codebase of
# `$1` (a composer project template with its version) in it.
function webships_create_project() {
  base_url="https://${PROJECT_NAME}.ddev.site";

  cd ${WORKSPACE_ROOT}/${doc_name};
  drop_database;
  if [ -d "${PROJECT_NAME}" ]; then
    rm -rf ${PROJECT_NAME}
  fi
  mkdir -p ${PROJECT_NAME} ;
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

  ddev config --project-type=drupal --docroot=${distribution_webroot} --php-version=${webships_php_version} --project-name=${PROJECT_NAME} --auto ;
  ddev start -y ;

  if ! ddev composer create-project "$1" . --no-interaction ; then
    echo "composer create-project failed for $1 — aborting, nothing was installed." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  # The API packages ship stable releases and development releases side by side;
  # a build of the development line needs dev to be acceptable.
  ddev composer config minimum-stability dev ;
  ddev composer config prefer-stable true ;

  # Keep the API site templates as recipes, the way the project template does:
  # the installer finds them in recipes/ without Composer unpacking them.
  ddev composer config --json --merge extra.drupal-recipe-unpack.ignore '["drupal/webships_starter", "drupal/webapi_starter"]' ;
}

# The shared steps after a successful install.
function webships_after_install() {
  drush_set_debug_on;
  drush_cr;

  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_users ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  ${PROJECT_NAME} is ready: ${base_url}";
  echo "  The API is served from ${base_url}/api";
  echo "  The API documentation is at ${base_url}/api-docs";
  echo "*---------------------------------------------------------------------*";

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# Report what the built site actually serves, rather than assuming the recipe applied.
function webships_report_api_state() {
  echo "";
  echo "JSON:API read-only setting:";
  ddev drush config:get jsonapi.settings read_only 2>/dev/null || echo "  (jsonapi.settings not readable)" ;
  echo "Themes:";
  ddev drush config:get system.theme 2>/dev/null || echo "  (system.theme not readable)" ;
}

# drupal/webships_project installed by the Webships installer with --template.
function build_webships_project() {
  local template="${TEMPLATE:-webships_starter}" ;

  webships_create_project "${distribution_project_template}:${site_version}" || return 1 ;

  # Add whatever the published project template does not require yet, so a build
  # of an older tag still gets both API site templates.
  local require_block missing=() ;
  require_block=$(sed -n '/"require": {/,/}/p' composer.json) ;
  for package in "drupal/webships_starter:^1" "drupal/webapi_starter:^1" ; do
    if ! echo "${require_block}" | grep -q "\"${package%%:*}\"" ; then
      echo "${distribution_project_template} does not require ${package%%:*} yet — adding it." ;
      missing+=("${package}") ;
    fi
  done

  local composer_ok=1 ;
  if [ ${#missing[@]} -gt 0 ] ; then
    ddev composer require --no-update --no-interaction "${missing[@]}" || composer_ok=0 ;
    if [ ${composer_ok} -eq 1 ] ; then
      ddev composer update -W --no-interaction || composer_ok=0 ;
    fi
  fi
  if [ ${composer_ok} -eq 0 ] ; then
    echo "composer failed — aborting before the install." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  set_default_settings ;

  echo "Install ${distribution_title} with the Webships installer and the ${template} site template.";
  if ! ddev drush site:install webships --yes \
    installer_site_template_form.add_ons=${template} \
    --site-name="${distribution_title}" \
    --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" \
    --locale="en" ; then
    echo "" ;
    echo "The ${template} install failed — read the error above. The codebase is kept: ${base_url}/core/install.php" ;
    cd ${WORKSPACE_ROOT}/${doc_name} ;
    return 1 ;
  fi

  webships_report_api_state ;
  webships_after_install ;
}

# One API site-template recipe on a plain Drupal 11.4.x recommended project.
function build_webships_site_template() {
  webships_create_project "drupal/recommended-project:${webships_core_version}" || return 1 ;

  if ! ddev composer require -W --no-interaction "drush/drush:^13" "${site_template_package}:${site_version}" ; then
    echo "composer require ${site_template_package}:${site_version} failed — aborting before the install." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  set_default_settings ;

  echo "Install Drupal ${webships_core_version} with the ${site_template_title} recipe.";
  if ! ddev drush site:install /var/www/html/recipes/${site_template_name} --yes \
    --site-name="${site_template_title}" \
    --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" \
    --locale="en" ; then
    echo "" ;
    echo "The ${site_template_title} install failed — read the error above." ;
    cd ${WORKSPACE_ROOT}/${doc_name} ;
    return 1 ;
  fi

  webships_report_api_state ;
  webships_after_install ;
}
