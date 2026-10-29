#!/usr/bin/env bash

# Whether the Drupal CMS installer will fetch the site template itself.
#
# Drupal CMS lists a curated set of site templates (drupal_cms_installer's site-templates.yml),
# and picking one in the browser runs `composer require` for it. So a build that stops at the
# installer needs no require of its own: it is the plain `composer create-project drupal/cms`
# the project pages publish. A builder opts in with site_template_listed="yes". An explicit
# --site-template-version still requires, since the installer takes whatever is latest, and
# --install still requires, since drush cannot download anything.
function site_template_fetched_by_installer() {
  [ "${site_template_listed:-}" == 'yes' ] \
    && [ "${installer_profile:-}" == 'drupal_cms_installer' ] \
    && [ "${INSTALL}" != 'yes' ] \
    && [ "${SITE_TEMPLATE_VERSION}" == "${site_template_version:-}" ] ;
}

# Build a Drupal CMS or Varbase site with a site template, and install it.
#
# A site template is a `Site` recipe (https://new.drupal.org/browse/site-templates).
# The installer normally asks which one to use; `drush site:install` answers that
# step non-interactively through the installer form:
#
#   installer_site_template_form.add_ons=<recipe directory name>
#
# The recipe directory name is the package name without the `drupal/` vendor
# prefix, which is where composer puts a `drupal-recipe` package.
#
# Drupal CMS asks that question from the `drupal_cms_installer` profile; Varbase
# 11 asks the same question, with the same form id and the same `add_ons`
# element, from its own profile
# (\Drupal\varbase\Installer\Form\SiteTemplateForm), so one non-interactive
# install covers both. Set `installer_profile` to pick which one.
#
# The calling cmd-*.sh sets: site_template_name, site_template_package and,
# optionally, site_template_title and installer_profile.
function build_site_template() {

  # Which install profile asks the site-template question.
  installer_profile="${installer_profile:-drupal_cms_installer}";

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
  ddev_telemetry_off ;
  ddev_up start ;

  if ! ddev composer create-project ${distribution_project_template} . --no-interaction; then
      echo "" ;
      echo "The composer step above failed, so there is no ${site_template_title:-${site_template_name}} codebase to install." ;
      echo "Stopping here instead of reporting a site as ready: read the resolver output above." ;
      cd ${WORKSPACE_ROOT}/${doc_name} ;
      return 1 ;
  fi

  # Drop optional apt extras, in case the project template shipped its own .ddev
  # config.
  #
  # No --database flag. It used to pin mariadb:10.11 here, AFTER `ddev start` had
  # already provisioned the volume with DDEV's own default. On a DDEV whose default
  # has moved on (11.8) that combination cannot start at all:
  #   project <name> is configured for database mariadb:10.11, but its database
  #   volume holds mariadb:11.8
  # The Drupal CMS path below never had the flag, for exactly this reason.
  ddev config --webimage-extra-packages="" --php-version=${PHP_VERSION} ;
  ddev_telemetry_off ;
  ddev_up restart ;

  # Add the site template itself, unless the installer will.
  # A failed require used to fall straight through to "is ready to install!!!!" -- or, with
  # --install, to a site:install on a codebase that has no site template in it, which then
  # failed with an error about the install instead of the resolver output that explains it.
  if site_template_fetched_by_installer ; then
    echo "Drupal CMS lists ${site_template_card:-${site_template_title:-${site_template_name}}} and downloads it when it is picked: nothing to require." ;
  else
    if [ -n "${SITE_TEMPLATE_VERSION}" ]; then
      site_template_require="${site_template_package}:${SITE_TEMPLATE_VERSION}";
    else
      site_template_require="${site_template_package}";
    fi
    # On a Varbase base the require needs -W (--update-with-all-dependencies).
    # drupal/varbase_project pins varbase_recipes, and a site template pulls a newer
    # set, so a plain require cannot resolve -- and, because nothing is installed, the
    # run reaches drush site:install and fails there with "The submitted value <name>
    # in the add_ons element is not allowed", which reads as a defect in the recipe
    # rather than a package that was never installed. The Drupal CMS base resolves
    # without it, so the flag is added only where it is needed.
    site_template_require_flags="";
    if [ "${distribution_name}" == 'varbase' ] ; then
      site_template_require_flags="-W";
    fi
    if ! ddev composer require "${site_template_require}" ${site_template_require_flags} --no-interaction; then
        echo "" ;
        echo "The composer step above failed, so there is no ${site_template_title:-${site_template_name}} codebase to install." ;
        echo "Stopping here instead of reporting a site as ready: read the resolver output above." ;
        cd ${WORKSPACE_ROOT}/${doc_name} ;
        return 1 ;
    fi
  fi

  # Require all custom required packages.
  # argparse.sh emits an nargs='+' option as a bash ARRAY, so plain ${REQUIRE} is only its FIRST
  # element: `--require a b` used to drop b. [0] still reads the sentinel on a scalar default.
  if [ "${REQUIRE[0]}" == '_none_' ] ; then
    echo "No extra composer required." ;
  else
    ddev composer require ${REQUIRE[*]} ;
  fi

  if [ "${INSTALL}" != 'yes' ] ; then
    echo "${PROJECT_NAME} is ready to install!!!!";
    echo "Go to ${base_url}/core/install.php and pick the ${site_template_card:-${site_template_title:-${site_template_name}}} site template.";
  else
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
      echo "To take the same steps by hand, rebuild with --skip-install and use ${base_url}/core/install.php." ;
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
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  ${site_template_title:-${site_template_name}} is ready:";
  echo "    ${hub_url}";
  echo "    ${base_url}";
  echo "*---------------------------------------------------------------------*";

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# Build a plain Drupal CMS site with a Vardot site template, and install it.
#
# A Vardot `Site` recipe (Varbase Starter, Educare, Horizon Aid) installs on a
# `drupal/cms` base as well as on Varbase 11, but a stock Drupal CMS codebase
# carries none of the composer/npm wiring drupal/varbase_project ships, and
# build_site_template's first composer step is the site-template require — too
# late to add it. So this is the Drupal-CMS path: the same base-codebase steps,
# then the wiring, then the require and the same non-interactive install.
#
# What a stock drupal/cms is missing:
#
#  1. `minimum-stability: dev` + `prefer-stable: true`. drupal/cms ships
#     `stable`, and every drupal/varbase_*_base a Vardot site template requires
#     is 1.0.x-dev (vartheme_bs5 is 5.0.x-dev), so the require fails with
#     "Could not find a version of package … matching your minimum-stability".
#  2. vardot/varbase-patches (+ cweagans/composer-patches) so the Canvas patches
#     are applied — this is what lets drupal/canvas resolve to 1.9.0. The plugin
#     is default-deny, so config.allow-plugins and
#     extra.composer-patches.allowed-dependency-patches are wired the way
#     varbase_project's composer.json wires them.
#  3. `allow-plugins.oomphinc/composer-installers-extender`. vardot/varbase-patches
#     pulls it in and drupal/cms does not allow it, so composer aborts the install
#     step with "contains a Composer plugin which is blocked by your allow-plugins
#     config" and vendor/vardot/ is never written.
#  4. Two Composer installer paths. The front-end libraries (ace, dropzone,
#     fancytree, swagger-ui, aos and the CKEditor media-embed plugin) are
#     drupal-library packages on Packagist now, required by the module or the
#     varbase_* recipe that loads each one, so requiring the site template
#     brings them in. But swagger-api/swagger-ui is type "library" rather than
#     drupal-library, and drupal/ckeditor_media_embed loads its plugin from a
#     nested path, so those two need naming explicitly. Nothing copies files
#     out of node_modules any more, and no Yarn step is needed to get them.
#
# The calling cmd-*.sh sets: site_template_name, site_template_package and,
# optionally, site_template_title and varbase_patches_constraint.
function build_site_template_drupalcms() {

  # Drupal CMS asks the site-template question from its own installer profile.
  installer_profile="drupal_cms_installer";

  # Base, fixed: this path exists for the plain Drupal CMS base.
  distribution_name="drupal_cms";
  distribution_title="${distribution_title:-Drupal CMS}";
  distribution_webroot="${distribution_webroot:-web}";
  distribution_project_template="${distribution_project_template:-drupal/cms}";

  # Matches drupal/varbase_project's require.vardot/varbase-patches.
  varbase_patches_constraint="${varbase_patches_constraint:-11.0.x-dev}";

  # dev or stable, and it decides whether the root's stability is loosened at
  # all. A 1.0.x-dev site template pulls 1.0.x-dev varbase_*_base packages,
  # which cannot resolve against drupal/cms's `minimum-stability: stable`, so
  # the dev builders loosen it. A builder pinned to a RELEASED tag sets stable
  # and gets the plain steps published on the project page -- create-project
  # drupal/cms, require the template -- with the root stability untouched.
  site_template_stability="${site_template_stability:-dev}";

  # A listed template the browser installer will fetch needs none of the wiring below: the
  # published flow is a stock drupal/cms, and that is what build_site_template builds.
  if site_template_fetched_by_installer ; then
    build_site_template ;
    return $? ;
  fi

  base_url="https://${PROJECT_NAME}.ddev.site";
  hub_url="https://${PROJECT_NAME}.${doc_name}.workspace.ddev.site";

  cd ${WORKSPACE_ROOT}/${doc_name};

  drop_database;

  if [ -d "${PROJECT_NAME}" ]; then
    rm -rf ${PROJECT_NAME}
  fi

  mkdir -p ${PROJECT_NAME} ;
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

  # No --database flag: DDEV's own default is kept, because forcing a different
  # database type onto the one DDEV just provisioned errors out.
  ddev config --project-type=drupal11 --docroot=${distribution_webroot} --php-version=${PHP_VERSION} --project-name=${PROJECT_NAME} --auto ;
  ddev_telemetry_off ;
  ddev_up start ;

  # --no-install --no-scripts: nothing may be installed before the patch
  # wiring below is written. composer patches a package only when it INSTALLS
  # it, so a plain create-project puts drupal/core on disk before
  # cweagans/composer-patches and vardot/varbase-patches are active plugins,
  # and core's curated patches are then silently skipped -- including the fix
  # for core issue #2741429, without which drupal_cms_search's display
  # cloning fatals during the install with "getConfigDependencyName() on
  # null". The recipe's own CI job passes because it defers the install the
  # same way.
  if ! ddev composer create-project ${distribution_project_template} . --no-interaction --no-install --no-scripts; then
      echo "" ;
      echo "The composer step above failed, so there is no ${site_template_title:-${site_template_name}} codebase to install." ;
      echo "Stopping here instead of reporting a site as ready: read the resolver output above." ;
      cd ${WORKSPACE_ROOT}/${doc_name} ;
      return 1 ;
  fi

  # Drop optional apt extras, in case the project template shipped its own
  # .ddev config.
  ddev config --webimage-extra-packages="" --php-version=${PHP_VERSION} ;
  ddev_telemetry_off ;
  ddev_up restart ;

  # The wiring, before the site template is ever resolved.
  if [ "${site_template_stability}" == 'dev' ] ; then
    ddev composer config minimum-stability dev ;
    ddev composer config prefer-stable true ;
  fi
  ddev composer config allow-plugins.cweagans/composer-patches true ;
  ddev composer config allow-plugins.vardot/varbase-patches true ;
  ddev composer config allow-plugins.oomphinc/composer-installers-extender true ;
  ddev composer config extra.enable-patching true ;
  ddev composer config extra.composer-exit-on-patch-failure true ;
  ddev composer config --json extra.composer-patches.allowed-dependency-patches '["vardot/varbase-patches", "vardot/drupal-core-patches"]' ;
  # Default-deny is not enough on its own: composer-patches still TRIES a
  # dependency's own patch, and drupal/ai_context declares one with a path
  # relative to the project root ("patches/canvas-3575644-…patch"). That only
  # resolves from a root that happens to ship the file, so the require aborts
  # with "could not be downloaded: Failed to open stream". Ignore those outright,
  # exactly as drupal/varbase_project does.
  ddev composer config --json extra.composer-patches.ignore-dependency-patches '["drupal/*", "drupal/ai_context"]' ;
  # Keep the root composer.json readable: drupal/core-recipe-unpack otherwise
  # flattens every dependency of a `drupal-recipe` into the root require and
  # drops the recipe itself, so the site template disappears from the file it is
  # the whole point of and ~190 transitive entries take its place. The recipe is
  # still installed into recipes/, it just stays a single named requirement.
  ddev composer config --json extra.drupal-recipe-unpack.on-require 'false' ;
  ddev composer require "cweagans/composer-patches:~2.0" "vardot/varbase-patches:${varbase_patches_constraint}" --no-interaction ;

  # The site template itself.
  # A failed require used to fall straight through to "is ready to install!!!!" -- or, with
  # --install, to a site:install on a codebase that has no site template in it, which then
  # failed with an error about the install instead of the resolver output that explains it.
  if [ -n "${SITE_TEMPLATE_VERSION}" ]; then
    site_template_require="${site_template_package}:${SITE_TEMPLATE_VERSION}";
  else
    site_template_require="${site_template_package}";
  fi
  if ! ddev composer require "${site_template_require}" --no-interaction; then
      echo "" ;
      echo "The composer step above failed, so there is no ${site_template_title:-${site_template_name}} codebase to install." ;
      echo "Stopping here instead of reporting a site as ready: read the resolver output above." ;
      cd ${WORKSPACE_ROOT}/${doc_name} ;
      return 1 ;
  fi

  # Require all custom required packages.
  # argparse.sh emits an nargs='+' option as a bash ARRAY, so plain ${REQUIRE} is only its FIRST
  # element: `--require a b` used to drop b. [0] still reads the sentinel on a scalar default.
  if [ "${REQUIRE[0]}" == '_none_' ] ; then
    echo "No extra composer required." ;
  else
    ddev composer require ${REQUIRE[*]} ;
  fi

  # A site template MAY still ship scripts/drupal-cms-wiring.php. It is optional:
  # the composer wiring above is complete on its own, and Educare dropped its
  # script (drupal.org/project/educare/issues/3618244) because a Varbase base
  # needs none of it. Run it when present — it is idempotent and merges
  # additively — and carry on either way.
  if [ -f "recipes/${site_template_name}/scripts/drupal-cms-wiring.php" ]; then
    echo "Wiring from the site template's own script: recipes/${site_template_name}/scripts/drupal-cms-wiring.php" ;
    ddev exec php "recipes/${site_template_name}/scripts/drupal-cms-wiring.php" ;
    return_from_template_script=$? ;
    if [ "${return_from_template_script}" -ne 0 ]; then
      echo "The site template's Drupal CMS wiring script failed. Stopping." ;
      exit 1 ;
    fi
  else
    echo "No drupal-cms-wiring.php in the ${site_template_name} recipe — using the built-in wiring." ;

    # The front-end libraries are Composer packages now, each required by the
    # module or the varbase_* recipe that loads it, so requiring the site
    # template pulls them in and composer/installers places them.
    ddev composer config --json 'extra.installer-paths.web/libraries/ckeditor5/plugins/media-embed' '["vardot/ckeditor5-media-embed-drupal"]' ;

  fi

  if [ "${INSTALL}" != 'yes' ] ; then
    echo "${PROJECT_NAME} is ready to install!!!!";
    echo "Go to ${base_url}/core/install.php and pick the ${site_template_card:-${site_template_title:-${site_template_name}}} site template.";
  else
    echo "Install ${distribution_title} with the ${site_template_title:-${site_template_name}} site template.";
    # Stop here when the install fails: a site template that throws part way
    # through leaves a half-installed site, and running the user/debug steps on
    # top of that hides which step actually broke.
    if ! ddev drush site:install ${installer_profile} --yes \
      installer_site_template_form.add_ons=${site_template_name} \
      --site-name="${site_template_title:-${site_template_name}}" \
      --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" \
      --locale="en" ; then
      echo "" ;
      echo "The ${site_template_title:-${site_template_name}} install failed — the site is half-installed." ;
      echo "Read the error above: a site template that pins a stale Canvas component_version," ;
      echo "or ships config another module already provides, fails at the recipe step." ;
      echo "To take the same steps by hand, rebuild with --skip-install and use ${base_url}/core/install.php." ;
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
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  ${site_template_title:-${site_template_name}} is ready:";
  echo "    ${hub_url}";
  echo "    ${base_url}";
  echo "*---------------------------------------------------------------------*";

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}
