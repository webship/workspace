#!/usr/bin/env bash

# Add Drush if it was not in the system.
function add_drush() {
  echo "Add Drush if it was not in the system.";
  if [ ! -d "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/vendor/drush/drush" ]; then
    cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME};
    # Which Drush a core can take is a fact about that core, so a builder may declare it
    # and the rest keep what they have always had. Drupal 12 needs its own: core 12
    # requires guzzle 8, every tagged Drush (through 13) requires guzzle ^7, and the
    # resolver refuses the pair — which surfaces LATER as "drush is not available" at
    # site:install, three steps from the line that caused it.
    ddev composer require "drush/drush:${site_drush_version:-~11 || ~13}";
  fi

  # DDEV rewrites its shared command directory whenever ANY project on this machine starts, and `ddev drush`
  # is missing from it for a moment. Wait for it, instead of failing the install on its very first line.
  local attempt;
  for attempt in 1 2 3 4 5 6 7 8 9 10 ; do
    ddev drush --version > /dev/null 2>&1 && return 0 ;
    echo "ddev drush is not available yet (attempt ${attempt} of 10), waiting." ;
    sleep 6 ;
  done
  echo "ddev drush is still not available — the install cannot start." ;
  return 1 ;
}

# Cache Rebuilding ...
function drush_cr() {
  echo "Cache Rebuilding ..."
  ddev drush cache:rebuild ;
}

# Set Aggrigation off and error level all
function drush_set_debug_on() {
  echo "Set Aggrigation off and error_level on";
  ddev drush config:set system.performance css.preprocess 0 --yes ;
  ddev drush config:set system.performance js.preprocess 0 --yes ;
  ddev drush config:set system.logging error_level all --yes ;
}

# Set Aggrigation ON and error level OFF
function drush_set_debug_off() {
  echo "Set Aggrigation ON and error_level OFF";
  ddev drush config:set system.performance css.preprocess 1 --yes ;
  ddev drush config:set system.performance js.preprocess 1 --yes ;
  ddev drush config:set system.logging error_level 0 --yes ;
}
