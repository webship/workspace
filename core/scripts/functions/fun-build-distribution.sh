#!/usr/bin/env bash

# composer install, once more if it fails: the first install in a fresh project can fail on a git cache hiccup
# ("<commit> is gone") and pass straight away on the second try. A real dependency problem fails both times.
function composer_install_retry() {
  ddev composer install --no-interaction && return 0 ;
  echo "composer install failed once, trying it again before giving up." ;
  ddev composer install --no-interaction ;
}

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

  # Which PHP the project gets, from the most specific answer available:
  #
  #   1. --php-version, if whoever ran this asked for one;
  #   2. site_php_version, if the BUILDER declares one its core requires — Drupal 12 does, its
  #      composer.json says `php: >=8.5.0` and DDEV's default is 8.4, so without it the build gets as
  #      far as composer and stops on a platform requirement, which reads as the builder being broken
  #      rather than as a version being needed;
  #   3. nothing, and DDEV picks its own default exactly as before.
  #
  # The flag wins over the builder's declaration on purpose: a builder says what its core NEEDS, and
  # somebody passing --php-version is saying what they want to build on — testing an older PHP against
  # a core that allows it is the whole reason the flag exists. A version the core cannot take fails in
  # composer with a platform requirement that names it, which is a better answer than silently
  # ignoring what was asked for.
  php_version="${PHP_VERSION:-${site_php_version:-}}" ;
  ddev config --project-type=drupal --docroot=${distribution_webroot} --project-name=${PROJECT_NAME} \
    ${php_version:+--php-version=${php_version}} --nodejs-version=$(ddev_nodejs_version) --auto ;
  ddev_telemetry_off ;
  ddev_up start ;

  # Capture the db type actually running before composer create-project can change it,
  # so the re-align below restores it instead of a stale hardcoded version.
  provisioned_db_type=$(grep -A2 '^database:' .ddev/config.yaml | grep 'version:' | awk '{print $2}' | tr -d '"') ;

  # --dev builds the development branch instead of the pinned release. Each
  # builder that supports it declares site_version_dev next to site_version;
  # asking for --dev on one that does not is an error, not a silent fallback.
  if [ "${DEV}" == 'yes' ] ; then
    if [ -z "${site_version_dev}" ] ; then
      echo "--dev is not supported by this builder (no development branch declared)." ;
      cd ${WORKSPACE_ROOT}/${doc_name};
      return 1 ;
    fi
    site_version="${site_version_dev}" ;
    # A development branch's dependencies are development branches too.
    dev_stability="--stability dev" ;
  elif [ -n "${site_version_stability}" ] ; then
    # A major that has not reached a stable release yet. Composer's default minimum is
    # `stable`, so a caret constraint that today matches only an alpha resolves to
    # NOTHING and the build stops with "could not find a version in a stable enough
    # version" — which is how a latest-per-major builder looks broken on the day the
    # major it tracks opens. A declared floor says how far down this builder is willing
    # to go, and it needs no edit later: composer still prefers the highest match, so
    # the first stable release wins over every pre-release of it on its own.
    dev_stability="--stability ${site_version_stability}" ;
  fi

  # A failed create-project (e.g. an upstream patch no longer applying) must stop the
  # build here — every step after this assumes a real vendor/autoload.php exists.
  #
  # A release line may need two things before its first install, or composer cannot resolve it at all:
  #   site_composer_requires  root requirements, e.g. an alias. a Drupal 10 line may ask for a package
  #                           that moved to Drupal 11, so the line aliases the last Drupal 10 release.
  #   site_patches_ignore     "<package> <patch-url>" pairs that webship/patches declares and the release
  #                           already contains, so applying the patch fails (patches-ignore, added to composer.json).
  # Both are declared by the builder as bash arrays. A builder that declares neither installs in one step as before.
  site_requires=("${site_composer_requires[@]}") ;
  site_ignores=("${site_patches_ignore[@]}") ;
  if [ -n "${site_requires[0]:-}${site_ignores[0]:-}" ] ; then
    if ! ddev composer create-project ${distribution_project_template}:${site_version} . --no-interaction --no-install --no-scripts ${dev_stability:-} ; then
      echo "composer create-project failed for ${distribution_project_template}:${site_version} — aborting, not installing." ;
      cd ${WORKSPACE_ROOT}/${doc_name};
      return 1 ;
    fi
    if [ -n "${site_requires[0]:-}" ] ; then
      ddev composer require "${site_requires[@]}" --no-update --no-interaction || { cd ${WORKSPACE_ROOT}/${doc_name}; return 1 ; } ;
    fi
    if [ -n "${site_ignores[0]:-}" ] ; then
      patches_ignore_json=$(python3 -c 'import sys, json; d = {}; [d.setdefault("webship/patches", {}).setdefault(a.split(" ", 1)[0], []).append(a.split(" ", 1)[1]) for a in sys.argv[1:]]; print(json.dumps(d))' "${site_ignores[@]}") ;
      ddev composer config --json extra.patches-ignore "${patches_ignore_json}" || { cd ${WORKSPACE_ROOT}/${doc_name}; return 1 ; } ;
    fi
    if ! composer_install_retry || ! ddev composer run-script post-create-project-cmd ; then
      echo "composer could not install ${distribution_project_template}:${site_version} — aborting, not installing." ;
      cd ${WORKSPACE_ROOT}/${doc_name};
      return 1 ;
    fi
  elif ! ddev composer create-project ${distribution_project_template}:${site_version} . --no-interaction ${dev_stability:-} ; then
    # When the project reached the install step, composer.json is already in place: install once more.
    if [ -f composer.json ] && composer_install_retry && ddev composer run-script post-create-project-cmd ; then
      echo "composer create-project needed a second install, which worked." ;
    else
      echo "composer create-project failed for ${distribution_project_template}:${site_version} — aborting, not installing." ;
      cd ${WORKSPACE_ROOT}/${doc_name};
      return 1 ;
    fi
  fi

  # Some project templates ship their own .ddev config that
  # changes the docroot/database/webimage packages after our initial ddev
  # config. Re-align: keep the database type we already provisioned, drop
  # optional apt extras (avoids third-party repo key failures), keep our Node.js, and restart
  # so the webserver serves the template's real docroot.
  ddev config --database=mariadb:${provisioned_db_type} --webimage-extra-packages="" --nodejs-version=$(ddev_nodejs_version) ;
  ddev_telemetry_off ;
  ddev_up restart ;

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

    # Install distribution with Drush. A failed install stops the build: every step after it assumes an
    # installed site, and carrying on printed "has been installed" over a half-installed one.
    if ! install_${distribution_name}_with_drush ; then
      echo "The install of ${doc_name} ${PROJECT_NAME} failed — drush site:install did not finish, so the site is not usable." ;
      echo "The project is kept for inspection: ${base_url} (ddev logs, ddev drush status)." ;
      cd ${WORKSPACE_ROOT}/${doc_name};
      return 1 ;
    fi
    # Enable extra components;
    enable_${distribution_name}_extra_components ;
    # Set Aggrigation off and error level all
    drush_set_debug_on;
    # Cache Rebuilding ...
    drush_cr;

    # A step above can leave the site installed but broken (a module that fails half way). Say so here,
    # instead of announcing an installed site that answers with a 500.
    if ! ddev drush status --field=bootstrap 2>/dev/null | grep -q Successful ; then
      echo "${doc_name} ${PROJECT_NAME} was installed, but Drupal does not bootstrap: a step above failed half way." ;
      echo "Read the 'Failed to run' lines above, or run: ddev drush status ; ddev logs." ;
      cd ${WORKSPACE_ROOT}/${doc_name};
      return 1 ;
    fi

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

  # --launch opens the site in the browser: the installed site, or the browser
  # installer when --install was not asked for.
  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}
