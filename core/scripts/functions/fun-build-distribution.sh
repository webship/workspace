#!/bin/usr/env bash

function build_distribution() {
  # Include distribution functions.
  source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-distribution-${distribution_name}.sh || exit 1 ;

  base_url="https://${PROJECT_NAME}.ddev.site";

  # Change directory to the workspace for this full operation.
  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name};

  if [ ! "${SKIP_DROP_DATABASE}" == 'yes' ] ; then
    drop_database;
  fi

  if [ -d "${PROJECT_NAME}" ]; then
    rm -rf ${PROJECT_NAME}
  fi

  # Create the project folder and bring up its DDEV environment first, so
  # composer/drush run inside the project's own containers from here on.
  mkdir -p ${PROJECT_NAME} ;
  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

  ddev config --project-type=drupal --docroot=${distribution_webroot} --project-name=${PROJECT_NAME} --auto ;
  ddev start ;

  ddev composer create-project ${distribution_project_template}:${site_version} . --no-interaction -vvv;

  # Change the minimum stablility to dev for development
  ddev composer config minimum-stability dev ;

  # Require all custom required packages.
  echo "Require all custom required packages.";
  if [ "${REQUIRE}" == '_none_' ] ; then
    echo "No extra composer required." ;
  else
    ddev composer require ${REQUIRE} ;
  fi

  # Add Gleap
  if [ "$GLEAP" == 'yes' ] ; then
    add_gleap ;
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
    cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot};

    # Install distribution with Drush.
    install_${distribution_name}_with_drush ;
    # Enable extra components;
    enable_${distribution_name}_extra_components ;
    # Set Aggrigation off and error level all
    drush_set_debug_on;
    # Cache Rebuilding ...
    drush_cr;

    if [ "${ENABLE}" == '_none_' ] ; then
      echo "No extra selected modules to enlable." ;
    else
      ddev drush pm:enable ${ENABLE} --yes;
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

  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name};
}
