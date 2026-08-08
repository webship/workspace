#!/usr/bin/env bash

# Build a Drupal CMS site from a site template, and install it.
#
# A site template is a `Site` recipe (https://new.drupal.org/browse/site-templates).
# The installer normally asks which one to use; `drush site:install` answers that
# step non-interactively through the installer form:
#
#   installer_site_template_form.add_ons=<recipe directory name>
#
# The recipe directory name is the package name without the `drupal/` vendor
# prefix, which is where composer puts a `drupal-recipe` package. The question
# comes from the `drupal_cms_installer` profile; any distribution that asks it
# with the same form id and the same `add_ons` element works too — set
# `installer_profile` to pick which one.
#
# The calling cmd-*.sh sets: site_template_name, site_template_package and,
# optionally, site_template_title and installer_profile.
function build_site_template() {

  # Which install profile asks the site-template question.
  installer_profile="${installer_profile:-drupal_cms_installer}";

  # No flags: the latest release of the template, and the PHP version DDEV chooses.
  SITE_TEMPLATE_VERSION="";
  PHP_VERSION="${PHP_VERSION:-8.3}";

  base_url="https://${PROJECT_NAME}.ddev.site";
  hub_url="https://${PROJECT_NAME}.${doc_name}.workspace.ddev.site";

  # Change directory to the workspace for this full operation.
  cd ${WORKSPACE_ROOT}/${doc_name};

  drop_database;

  if [ -d "${PROJECT_NAME}" ]; then
    rm -rf ${PROJECT_NAME}
  fi

  mkdir -p ${PROJECT_NAME} ;
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

  ddev config --project-type=drupal11 --docroot=${distribution_webroot} --php-version=${PHP_VERSION} --project-name=${PROJECT_NAME} --auto ;
  ddev start ;

  # Capture the database version DDEV actually provisioned, before composer create-project can
  # bring its own .ddev config in and change it.
  provisioned_db_type=$(grep -A2 '^database:' .ddev/config.yaml | grep 'version:' | awk '{print $2}' | tr -d '"') ;

  if ! ddev composer create-project ${distribution_project_template} . --no-interaction ; then
    echo "composer create-project failed for ${distribution_project_template} — aborting, nothing was installed." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  # Keep the database we provisioned and drop optional apt extras, in case the
  # project template shipped its own .ddev config.
  ddev config --database=mariadb:${provisioned_db_type} --webimage-extra-packages="" --php-version=${PHP_VERSION} ;
  ddev restart ;

  # Add the site template itself.
  if [ -n "${SITE_TEMPLATE_VERSION}" ]; then
    ddev composer require "${site_template_package}:${SITE_TEMPLATE_VERSION}" --no-interaction;
  else
    ddev composer require "${site_template_package}" --no-interaction;
  fi

  echo "Install ${distribution_title:-Drupal CMS} with the ${site_template_title:-${site_template_name}} site template.";
  # Stop here when the install fails: a site template that throws part way
  # through leaves a half-installed site (config applied, default content
  # never imported), and running the user/debug steps on top of that hides
  # which step actually broke.
  if ! ddev drush site:install ${installer_profile} --yes \
    installer_site_template_form.add_ons=${site_template_name} \
    --site-name="${site_template_title:-${site_template_name}}" \
    --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" \
    --locale="en" ; then
    echo "" ;
    echo "The ${site_template_title:-${site_template_name}} install failed — the site is half-installed." ;
    echo "Read the error above: a site template that pins a stale Canvas component_version," ;
    echo "or ships config another module already provides, fails at the recipe step." ;
    echo "To take the same steps by hand, use ${base_url}/core/install.php and pick the template there." ;
    cd ${WORKSPACE_ROOT}/${doc_name} ;
    return 1 ;
  fi

  # Set aggregation off and the error level to all, then rebuild caches.
  drush_set_debug_on;
  drush_cr;

  ## Add the default set of users.
  if [ "${ADD_USERS}" == 'yes' ] ; then
  add_users ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  ${site_template_title:-${site_template_name}} is ready:";
  echo "    ${hub_url}";
  echo "    ${base_url}";
  echo "*---------------------------------------------------------------------*";

  cd ${WORKSPACE_ROOT}/${doc_name};
}
