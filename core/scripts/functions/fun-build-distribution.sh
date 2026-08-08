#!/usr/bin/env bash

function build_distribution() {
  # Include distribution functions.
  source ${WORKSPACE_SCRIPTS}/functions/fun-distribution-${distribution_name}.sh || exit 1 ;

  base_url="https://${PROJECT_NAME}.ddev.site";

  # Change directory to the workspace for this full operation.
  cd ${WORKSPACE_ROOT}/${doc_name};

  if [ ! "${SKIP_DROP_DATABASE}" == 'yes' ] ; then
    drop_database;
  fi

  if [ -d "${PROJECT_NAME}" ]; then
    rm -rf ${PROJECT_NAME}
  fi

  # Create the project folder and bring up its DDEV environment first, so
  # composer/drush run inside the project's own containers from here on.
  mkdir -p ${PROJECT_NAME} ;
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

  ddev config --project-type=drupal --docroot=${distribution_webroot} --project-name=${PROJECT_NAME} --auto ;
  ddev start ;

  # Capture the database version DDEV actually provisioned, before composer create-project can
  # bring its own .ddev config in and change it — the re-align below then restores what was
  # running rather than a version hardcoded here.
  provisioned_db_type=$(grep -A2 '^database:' .ddev/config.yaml | grep 'version:' | awk '{print $2}' | tr -d '"') ;

  # A failed create-project (an upstream patch that no longer applies, a yanked tag) has to stop
  # the build here. Every step below assumes a real vendor/autoload.php, so carrying on used to
  # mean "installing" nothing and then announcing success.
  if ! ddev composer create-project ${distribution_project_template}:${site_version} . --no-interaction ; then
    echo "composer create-project failed for ${distribution_project_template}:${site_version} — aborting, nothing was installed." ;
    cd ${WORKSPACE_ROOT}/${doc_name};
    return 1 ;
  fi

  # Some project templates ship their own .ddev config that
  # changes the docroot/database/webimage packages after our initial ddev
  # config. Re-align: keep the database type we already provisioned, drop
  # optional apt extras (avoids third-party repo key failures), and restart
  # so the webserver serves the template's real docroot.
  ddev config --database=mariadb:${provisioned_db_type} --webimage-extra-packages="" ;
  ddev restart ;

  # The template may define a different webroot than the distribution config
  # assumed — trust the project's own .ddev config from here on.
  actual_docroot=$(grep '^docroot:' .ddev/config.yaml | awk '{print $2}') ;
  if [ -n "${actual_docroot}" ] && [ "${actual_docroot}" != "${distribution_webroot}" ]; then
    echo "Template webroot is '${actual_docroot}' (distribution config said '${distribution_webroot}') — using the template's." ;
    distribution_webroot=${actual_docroot} ;
  fi

  # Change the minimum stablility to dev for development
  ddev composer config minimum-stability dev ;

  # Require all custom required packages.
  echo "Require all custom required packages.";
  # argparse.sh emits an nargs='+' option as a bash ARRAY, so a plain ${REQUIRE} is only its
  # FIRST element: `--require drupal/token drupal/ctools` used to install token and drop ctools
  # without a word. [0] still reads the sentinel when the default scalar is in place.
  if [ "${REQUIRE[0]}" == '_none_' ] ; then
    echo "No extra composer required." ;
  else
    ddev composer require ${REQUIRE[*]} ;
  fi

  ## Add default settings file before starting the install.
  if [ ! "$SKIP_SET_DEFULT_SETTINGS" == 'yes' ] ; then
    set_default_settings ;
  fi

  ## Install the site.
  if [ "$INSTALL" == 'yes' ] ; then
    echo "Install the site";

    # Add Drush if it was not in the system.
    add_drush ;

    # Change directory to the webroot.
    cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot};

    # Install distribution with Drush.
    install_${distribution_name}_with_drush ;
    # Enable extra components;
    enable_${distribution_name}_extra_components ;
    # Set Aggrigation off and error level all
    drush_set_debug_on;
    # Cache Rebuilding ...
    drush_cr;

    # Same array rule as --require above.
    if [ "${ENABLE[0]}" == '_none_' ] ; then
      echo "No extra selected modules to enable." ;
    else
      ddev drush pm:enable ${ENABLE[*]} --yes;
    fi

    ## Add default set of users.
    if [ "$ADD_USERS" == 'yes' ] ; then
    add_users ;
    fi

    # Send a notification.
    echo "${doc_name} ${PROJECT_NAME} has been installed!!!!";
    echo "Go to ${base_url}";

  else
    echo "${doc_name} ${PROJECT_NAME} is ready to install!!!!";
    echo "Go to ${base_url}";
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}
