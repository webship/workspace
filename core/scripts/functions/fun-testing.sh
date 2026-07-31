#!/usr/bin/env bash

# The automated-testing stack of an EXISTING project: set it up, and run it.
#
# The cmd-automated-testing-*-project.sh builders in the test workspace do this as part of
# building a site from nothing — they delete the directory first, which is exactly what you do not
# want on a project you already have. These two verbs are the same stack applied to a project that
# is already there.
#
# Two stacks are supported:
#
#   in-project  Some project templates ship a DDEV testing command of their own —
#               `ddev init-full-automated-testing` installs the site if needed, adds the testing
#               users and prepares Playwright. If the command is in the project, it is the right
#               one, because it knows that project.
#   webship-js  Everything else gets webship-js (Playwright + Cucumber-js) through its DDEV add-on,
#               github.com/webship/ddev-webship-js, which scaffolds cucumber.js, the feature files,
#               the step definitions and the report/screenshot/video directories, preserving
#               anything already there.
#
# Both write their results to <project>/tests/reports/, which is what the dashboard's Tests menu
# reads.

# Which stack a project has, or would get.
function testing_stack() {
  local project_path="$1";
  if [ -f "${project_path}/.ddev/commands/web/init-full-automated-testing" ] ; then
    printf 'in-project' ; return 0 ;
  fi
  # webship-js (github.com/webship/webship-js) is cucumber-js + Playwright, and its footprint is
  # the cucumber.js config at the project root plus the step definitions it points at.
  if [ -f "${project_path}/cucumber.js" ] || [ -d "${project_path}/tests/step-definitions" ] ; then
    printf 'webship-js' ; return 0 ;
  fi
  printf 'none';
}

# npm or yarn, decided by what the project actually carries rather than by preference: running
# `npm run` in a yarn workspace re-resolves the tree and can leave it unbuildable.
function testing_package_runner() {
  local project_path="$1";
  [ -f "${project_path}/yarn.lock" ] && { printf 'yarn' ; return 0 ; }
  printf 'npm';
}

function testing_require_project() {
  local project_path="$1";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}.";
    return 1 ;
  fi
  if [ ! -f "${project_path}/.ddev/config.yaml" ] ; then
    echo "${doc_name}/${PROJECT_NAME} is not a DDEV project — the testing stack runs inside DDEV.";
    return 1 ;
  fi
  return 0 ;
}

# Set the testing environment up on an existing project. Idempotent: the in-project command checks
# what is installed before it installs anything, and the webship add-on preserves every file it
# finds, so a second run adds what a first run missed rather than resetting the suite.
function testing_configure() {
  local project_path="${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" stack runner;
  testing_require_project "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;

  stack="$(testing_stack "${project_path}")";
  echo "";
  echo "Setting up automated testing for ${doc_name}/${PROJECT_NAME}.";
  echo "";

  ddev start -y || return 1 ;

  case "${stack}" in
    in-project)
      echo "This project ships its own DDEV testing command — using it.";
      ddev init-full-automated-testing || return 1 ;
      ;;
    *)
      # Also the path for `webship-js`: the add-on owns the scaffold, and re-getting it is how you
      # pick up a newer version of it.
      echo "Adding the webship-js DDEV add-on (Playwright + Cucumber-js).";
      if ! ddev add-on get webship/ddev-webship-js ; then
        # The add-on declares a minimum DDEV version, and the failure reads as an add-on error
        # rather than as "your DDEV is too old", which is what it actually means.
        echo "";
        echo "  The add-on could not be installed. It requires a newer DDEV than this machine has:";
        echo "    installed: $(ddev version 2>/dev/null | awk '$1 == "DDEV" && $2 == "version" {print $3}')";
        echo "  Update DDEV (https://ddev.readthedocs.io/en/stable/users/install/ddev-upgrade/),";
        echo "  then run this command again.";
        return 1 ;
      fi
      # The add-on scaffolds on post-start, so the restart is part of the install, not a nicety.
      ddev restart || return 1 ;
      ;;
  esac

  runner="$(testing_package_runner "${project_path}")";
  if [ -f "${project_path}/package.json" ] ; then
    echo "";
    echo "Installing the JS dependencies and the chromium browser.";
    ddev ${runner} install || true ;
    ddev npx playwright install-deps chromium || true ;
    ddev npx playwright install chromium || true ;
  fi

  # A site under test should fail loudly and serve unaggregated assets: a CSS aggregate makes a
  # failure screenshot unreadable, and a swallowed error is a scenario that fails for the wrong
  # reason. Best-effort — a non-Drupal project simply has no drush.
  if ddev drush status --field=bootstrap 2>/dev/null | grep -qi successful ; then
    echo "";
    echo "Tuning the site for testing (no aggregation, all errors visible).";
    ddev drush config:set system.performance css.preprocess 0 --yes > /dev/null 2>&1 ;
    ddev drush config:set system.performance js.preprocess 0 --yes > /dev/null 2>&1 ;
    ddev drush config:set system.logging error_level all --yes > /dev/null 2>&1 ;
    ddev drush cache:rebuild > /dev/null 2>&1 ;
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Testing is set up on ${doc_name}/${PROJECT_NAME} ($(testing_stack "${project_path}")).";
  echo "";
  echo "  Run it:      bash cmd-tools-testing.sh ${PROJECT_NAME} --run";
  echo "  One feature: bash cmd-tools-testing.sh ${PROJECT_NAME} --run --path tests/features/<name>.feature";
  echo "  By tag:      bash cmd-tools-testing.sh ${PROJECT_NAME} --run --tags @critical";
  echo "";
  echo "  The report lands in tests/reports/, and the dashboard's Tests menu reads it.";
  echo "*---------------------------------------------------------------------*";
}

# Run the suite. Everything happens inside DDEV — the browsers are in the web container, and the
# site under test is reachable there by its own name.
function testing_run() {
  local project_path="${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" stack runner script started status;
  testing_require_project "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;

  stack="$(testing_stack "${project_path}")";
  if [ "${stack}" == 'none' ] ; then
    echo "${doc_name}/${PROJECT_NAME} has no testing stack yet.";
    echo "  Set it up first: bash cmd-tools-testing.sh ${PROJECT_NAME} --configure";
    return 1 ;
  fi

  ddev start -y || return 1 ;
  runner="$(testing_package_runner "${project_path}")";
  started="$(date +%s)";

  echo "";
  echo "Running the ${BROWSER} suite of ${doc_name}/${PROJECT_NAME}.";
  echo "";

  # webship-js is cucumber-js driving Playwright, configured by the project's own cucumber.js.
  # The package scripts are the contract — `test:chromium` is
  #   BROWSER=chromium node ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js
  # — so an unfiltered run calls the script rather than reimplementing it, and a filtered run
  # reproduces exactly that command with the filter appended. The browser and headed-ness travel
  # as the environment variables the config reads (BROWSER, HEADLESS), not as flags cucumber has
  # no idea about.
  local env_prefix="BROWSER=${BROWSER}";
  [ "${HEADED}" == 'yes' ] && env_prefix="${env_prefix} HEADLESS=false";
  local cucumber="node ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js";
  local filter="";
  # Narrowing to one feature is an ENV var here, not a positional argument: these projects'
  # cucumber.js sets `paths: [process.env.FEATURES || 'tests/features/**/*.feature']`, and a config
  # `paths` wins over the path you type — passing it positionally silently ran all 275 scenarios.
  # A directory is expanded to the glob cucumber expects, so `--path tests/features/02-user` works.
  if [ ! "${TESTING_PATH}" == '_none_' ] ; then
    local features="${TESTING_PATH}";
    case "${features}" in
      *.feature|*'*'*) : ;;
      *) features="${features%/}/**/*.feature" ;;
    esac
    env_prefix="${env_prefix} FEATURES=\"${features}\"";
    filter="${filter} ";
  fi
  [ ! "${TAGS}" == '_none_' ] && filter="${filter} --tags \"${TAGS}\"";
  [ ! "${RETRY}" == '_none_' ] && filter="${filter} --retry ${RETRY}";
  # --dry-run compiles the suite and matches every step against the definitions without opening a
  # browser: seconds instead of the ~20 minutes a full suite takes, and it is what catches
  # an undefined step or a broken tag expression before a real run does.
  [ "${DRY_RUN}" == 'yes' ] && filter="${filter} --dry-run";

  if [ -n "${filter}" ] ; then
    echo "  ddev exec ${env_prefix} ${cucumber} ${filter}";
    ddev exec "${env_prefix} ${cucumber} ${filter}" ;
    status=$? ;
  else
    script="test:${BROWSER}";
    echo "  ddev ${runner} run ${script}";
    [ "${HEADED}" == 'yes' ] && script="test:headed";
    ddev exec "${env_prefix} ${runner} run ${script}" ;
    status=$? ;
  fi

  # The HTML report the dashboard reads is written by webship-js's own hook, unless the run
  # disabled it (WEBSHIP_REPORT_DISABLE=1, which CI does). Regenerate it when the JSON is there
  # and the HTML is not, so a run always leaves the artifact the Tests menu links to.
  if [ -f tests/reports/cucumber_report.json ] && [ ! -f tests/reports/cucumber_report.html ] ; then
    if grep -q '"generate-reports"' package.json 2>/dev/null ; then
      echo "";
      echo "Generating the HTML report.";
      ddev ${runner} run generate-reports || true ;
    fi
  fi

  echo "";
  echo "*---------------------------------------------------------------------*";
  if [ "${status}" -eq 0 ] ; then
    echo "  The suite passed in $(( $(date +%s) - started ))s.";
  else
    # A failing suite is a result, not a tooling error — say so plainly and point at the evidence
    # rather than burying it in a non-zero exit.
    echo "  The suite FAILED (exit ${status}) after $(( $(date +%s) - started ))s.";
    echo "  Every failed step leaves a screenshot and a DOM dump; each scenario leaves a recording.";
  fi
  echo "";
  echo "  Report:      ${doc_name}/${PROJECT_NAME}/tests/reports/cucumber_report.html";
  echo "  Screenshots: ${doc_name}/${PROJECT_NAME}/tests/screenshots/";
  echo "  Recordings:  ${doc_name}/${PROJECT_NAME}/tests/videos/";
  echo "  The dashboard's Tests menu shows all three, newest first.";
  echo "*---------------------------------------------------------------------*";
  return ${status} ;
}

function testing_command() {
  # --configure is the default, so it is only meaningful as a word — except together with --run,
  # where "set it up and then run it" is a real thing to ask for and used to lose the setup half.
  if [ "${CONFIGURE}" == 'yes' ] || [ ! "${RUN}" == 'yes' ] ; then
    testing_configure || return 1 ;
  fi
  if [ "${RUN}" == 'yes' ] ; then
    testing_run ;
  fi
}
