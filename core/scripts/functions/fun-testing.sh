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
# Where Playwright keeps its browsers.
#
# NOT the default `~/.cache/ms-playwright` inside the web container: that lives in the container's
# writable layer, so a `ddev restart` — which `ddev init-full-automated-testing` and the add-on both
# do as part of setting up — throws away the 113 MB that had just been downloaded, and the next run
# fails with "Executable doesn't exist at …/chrome-headless-shell". `/mnt/ddev-global-cache` is a
# docker volume DDEV mounts into every web container, so the download survives a restart AND is
# shared by every project instead of being fetched once per site. The directory names carry the
# Playwright build number, so two projects on two versions do not collide.
readonly TESTING_BROWSERS_PATH='/mnt/ddev-global-cache/ms-playwright';

# Install the browsers if they are not already in the shared cache. Idempotent and quick when they
# are, so it is safe to call before every run — which is what makes a wiped container self-heal
# rather than failing 275 scenarios in 1.6 seconds.
# PLAYWRIGHT_SKIP_BROWSER_GC=1 is not optional here.
#
# `playwright install` sweeps the browsers directory and DELETES every build its own version does
# not know about. In a per-container cache that is housekeeping; in a SHARED one it is one project
# destroying another's browser — and it did: installing for the dashboard (Playwright 1.62,
# chromium 1234) removed the 1223 build a project's suite was running against, which failed the
# remaining 213 of its 275 scenarios with "Executable doesn't exist" twenty minutes in. Skipping the
# collection leaves both builds in place; they are a few hundred MB and the disk is not the problem
# a shared cache was solving.
# The shared libraries chromium itself needs (libnspr4, libnss3, the X and font
# stack). They belong in the IMAGE, not in a running container: `ddev restart`
# recreates the container, so `playwright install-deps` run once at setup time is
# gone by the next suite and every scenario dies at browser launch with
#   error while loading shared libraries: libnspr4.so
# A build file in .ddev/web-build/ is rebuilt into the image on every start, so
# the libraries survive restarts, rebuilds and a `ddev delete` + rebuild.
readonly TESTING_BROWSER_LIBS_BUILD='.ddev/web-build/Dockerfile.playwright';

function testing_write_browser_libs_build() {
  local project_path="$1";
  mkdir -p "${project_path}/.ddev/web-build" || return 1 ;
  cat > "${project_path}/${TESTING_BROWSER_LIBS_BUILD}" <<'DOCKERFILE'
# The shared libraries Playwright's chromium needs, baked into the web image so
# they survive `ddev restart` — installed by the workspace testing tooling.
# Playwright resolves the package names for this Debian release itself; the apt
# list is the fallback for a build with no network access to npm.
# The third-party PHP repository of the web image is set aside while apt runs: an expired key
# there would fail the whole image build, and chromium's libraries are Debian's own.
RUN mkdir -p /tmp/apt-off && (mv /etc/apt/sources.list.d/php.list /tmp/apt-off/ 2>/dev/null || true) && \
    (npx --yes playwright@1.56 install-deps chromium || \
    (apt-get update && apt-get install -y --no-install-recommends \
      libnspr4 libnss3 libdbus-1-3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 \
      libdrm2 libatspi2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
      libgbm1 libxkbcommon0 libasound2t64 libpango-1.0-0 libcairo2 fonts-liberation)) ; \
    status=$? ; (mv /tmp/apt-off/php.list /etc/apt/sources.list.d/ 2>/dev/null || true) ; \
    rm -rf /var/lib/apt/lists/* ; exit $status
DOCKERFILE
}

# Is chromium actually able to start in this project's web container?
function testing_browser_libs_ok() {
  ddev exec 'ldconfig -p | grep -q libnspr4' > /dev/null 2>&1 ;
}

# Make sure it is, rebuilding the image once if it is not. Called before every
# run, so a project that predates this — or one whose image was rebuilt from an
# older config — heals itself instead of failing the whole suite at step one.
function testing_ensure_browser_libs() {
  local project_path="$1";
  if testing_browser_libs_ok ; then
    return 0 ;
  fi
  echo "";
  echo "The chromium libraries are missing from this project's web container — adding them to the image.";
  testing_write_browser_libs_build "${project_path}" || return 1 ;
  ddev restart || return 1 ;
  if testing_browser_libs_ok ; then
    echo "The browser libraries are in place.";
    return 0 ;
  fi
  echo "The browser libraries are still missing after the rebuild — check ${TESTING_BROWSER_LIBS_BUILD}.";
  return 1 ;
}

function testing_install_browsers() {
  echo "Making sure the Playwright browsers are in the shared DDEV cache.";
  ddev exec "PLAYWRIGHT_BROWSERS_PATH=${TESTING_BROWSERS_PATH} PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium" || return 1 ;
}

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
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}.";
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
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" stack runner;
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
    testing_ensure_browser_libs "${project_path}" || true ;
    testing_install_browsers || true ;
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
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" stack runner script started status;
  testing_require_project "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;

  stack="$(testing_stack "${project_path}")";
  if [ "${stack}" == 'none' ] ; then
    echo "${doc_name}/${PROJECT_NAME} has no testing stack yet.";
    echo "  Set it up first: bash cmd-tools-testing.sh ${PROJECT_NAME} --configure";
    return 1 ;
  fi

  # Start it only if it is not already up. `ddev start` on a running project RECREATES its
  # containers whenever the project rewrites its own config on boot (the site-template projects do,
  # for Storybook) — which throws away the container, occasionally trips the health wait, and used
  # to take the freshly downloaded browsers with it. A running project is left alone.
  if ddev describe -j 2>/dev/null | grep -q '"status":"running"' ; then
    echo "${doc_name}/${PROJECT_NAME} is already running.";
  else
    ddev start -y || return 1 ;
  fi

  # A restart between setting up and running empties the container's own cache, so check before
  # opening a browser rather than after 275 scenarios have failed for the same missing file. The
  # libraries chromium links against are checked the same way and for the same reason.
  testing_ensure_browser_libs "${project_path}" || return 1 ;
  testing_install_browsers || return 1 ;
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
  local env_prefix="PLAYWRIGHT_BROWSERS_PATH=${TESTING_BROWSERS_PATH} BROWSER=${BROWSER}";
  [ "${HEADED}" == 'yes' ] && env_prefix="${env_prefix} HEADLESS=false";
  local cucumber="node ./node_modules/@cucumber/cucumber/bin/cucumber.js --config cucumber.js";
  local filter="";
  local run_log; run_log=$(mktemp);
  # Narrowing to one feature is an ENV var here, not a positional argument: these projects'
  # cucumber.js sets `paths: [process.env.FEATURES || 'tests/features/**/*.feature']`, and a config
  # `paths` wins over the path you type — passing it positionally silently ran all 275 scenarios.
  # A directory is expanded to the glob cucumber expects, so `--path tests/features/02-user` works.
  if [ ! "${TESTING_PATH}" == '_none_' ] ; then
    local features="${TESTING_PATH}";
    case "${features}" in
      *.feature|*.feature:[0-9]*|*'*'*) : ;;
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
    ddev exec "${env_prefix} ${cucumber} ${filter}" 2>&1 | tee "${run_log}" ;
    status=${PIPESTATUS[0]} ;
    # A run that matched nothing exits 0 too: a wrong --path or tag expression must not read as green.
    if grep -qE '^0 scenarios' "${run_log}" ; then
      echo "  No scenario ran: check the --path or --tags you gave." ;
      status=3 ;
    fi
    rm -f "${run_log}" ;
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
  if [ "${CONFIGURE}" == 'yes' ] || { [ ! "${RUN}" == 'yes' ] && [ ! "${DRY_RUN}" == 'yes' ] ; } ; then
    testing_configure || return 1 ;
  fi
  if [ "${RUN}" == 'yes' ] || [ "${DRY_RUN}" == 'yes' ] ; then
    testing_run ;
  fi
}
