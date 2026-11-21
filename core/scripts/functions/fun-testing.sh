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

# The webship-js extra-steps packs (@webship-js/*-steps): listing, adding, removing and copying the
# examples of one. The dashboard's Extra steps panel requires the same file, so the two never disagree.
readonly TESTING_STEP_PACKS_JS="${WORKSPACE_SCRIPTS}/libs/step_packs.js";

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

# The address DDEV routes to the project: its primary URL, read from `ddev describe -j`.
function testing_primary_url() {
  ddev describe -j 2>/dev/null | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const j = JSON.parse(s); process.stdout.write(String((j.raw && j.raw.primary_url) || "")); } catch (e) { /* no answer */ }
    });' 2>/dev/null ;
}

# After a restart the containers are up, but an app that starts on its own (a forum, a Node.js server) may not
# answer yet, and a platform hook that writes accounts or reads the site fails against it (#533). The site is asked
# from the web container, which reaches the project's own address through DDEV's router, until it answers, for up
# to TESTING_SITE_WAIT seconds (300 by default); after that the setup goes on and says so.
function testing_wait_for_site() {
  local url limit waited=0 code ;
  url="$(testing_primary_url)" ;
  limit="${TESTING_SITE_WAIT:-300}" ;
  [ -n "${url}" ] || return 0 ;
  while : ; do
    code="$(ddev exec curl -sk -o /dev/null -w '%{http_code}' --max-time 10 "${url}" 2>/dev/null | tr -dc '0-9')" ;
    case "${code}" in
      2??|3??|401|403|404)
        [ "${waited}" -gt 0 ] && echo "The site answers (${code}) after ${waited} s." ;
        return 0 ;;
    esac
    if [ "${waited}" -ge "${limit}" ] ; then
      echo "The site at ${url} did not answer within ${limit} s (last answer: ${code:-none}); the setup goes on." ;
      return 0 ;
    fi
    [ "${waited}" -eq 0 ] && echo "Waiting for ${url} to answer after the restart." ;
    sleep 5 ;
    waited=$(( waited + 5 )) ;
  done
}

# The testing stack is the same for every project; what is tested is not. A plugin that knows a
# platform (WordPress, Odoo, …) declares testing_configure_<plugin> in its functions file, and
# testing_configure calls every one of them, in the project folder, once the stack is scaffolded:
#
#   function testing_configure_wordpress() {
#     local project_path="$1";
#     [ -f "${project_path}/wp-config.php" ] || return 0 ;   # not mine: say nothing, change nothing
#     …add the step pack to package.json and cucumber.js…
#   }
#
# A hook answers for the projects it recognises and returns 0 for every other one. One that fails
# is reported and the setup goes on: the stack itself is in place either way.
function testing_configure_plugins() {
  local project_path="$1" hook;
  for hook in $(compgen -A function testing_configure_ | grep -v '^testing_configure_plugins$' | LC_ALL=C sort) ; do
    ( cd "${project_path}" && "${hook}" "${project_path}" ) \
      || echo "  ${hook} could not finish — the testing stack is set up without it." ;
  done
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

# What a failed `ddev add-on get` means, read from its own output (#512): GitHub's rate limit for
# anonymous API requests (many machines share one address, and DDEV asks GitHub for the add-on's
# releases), the DDEV version the add-on declares, or something else, which is left as it was said.
function testing_addon_failure_says() {
  local log="$1" ;
  if grep -qi 'rate limit' "${log}" ; then
    echo "  The add-on could not be fetched: GitHub's API answered with its rate limit for anonymous requests.";
    echo "  Give DDEV a GitHub token, then run this command again:";
    echo "    export DDEV_GITHUB_TOKEN=\$(gh auth token)    # any GitHub token will do; it needs no scopes";
  elif grep -qiE 'constraint|requires ddev|newer (version of )?ddev' "${log}" ; then
    echo "  The add-on could not be installed. It requires a newer DDEV than this machine has:";
    echo "    installed: $(ddev version 2>/dev/null | awk '$1 == "DDEV" && $2 == "version" {print $3}')";
    echo "  Update DDEV (https://ddev.readthedocs.io/en/stable/users/install/ddev-upgrade/),";
    echo "  then run this command again.";
  else
    echo "  The add-on could not be installed; DDEV's own words are above. To try it by hand:";
    echo "    cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} && ddev add-on get webship/ddev-webship-js";
  fi
}

# Is the webship-js add-on installed in this project? DDEV keeps a manifest of every add-on it installed, and the
# add-on's own config file is the part that matters: both there means a setup has what it needs without a new fetch.
function testing_addon_installed() {
  local project_path="$1" ;
  [ -f "${project_path}/.ddev/addon-metadata/ddev-webship-js/manifest.yaml" ] && [ -f "${project_path}/.ddev/config.webship-js.yml" ] ;
}

# The version DDEV recorded for the installed add-on, or nothing.
function testing_addon_version() {
  sed -nE 's/^version: *"?([^"]*)"?[[:space:]]*$/\1/p' "$1/.ddev/addon-metadata/ddev-webship-js/manifest.yaml" 2>/dev/null | head -n 1 ;
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

  # Started only when it is not running, as testing_run does: `ddev start` on a running project
  # recreates its web container, which can race DDEV's own copy of its global commands (#511).
  testing_ensure_running || return 1 ;

  case "${stack}" in
    in-project)
      echo "This project ships its own DDEV testing command — using it.";
      ddev init-full-automated-testing || return 1 ;
      ;;
    *)
      # Also the path for `webship-js`: the add-on owns the scaffold, and re-getting it is how you
      # pick up a newer version of it.
      echo "Adding the webship-js DDEV add-on (Playwright + Cucumber-js).";
      # Its own words go by as they are, and are read afterwards to say what a failure means (#512).
      local addon_log addon_status ;
      addon_log="$(mktemp)" ;
      ddev add-on get webship/ddev-webship-js 2>&1 | tee "${addon_log}" ;
      addon_status=${PIPESTATUS[0]} ;
      if [ "${addon_status}" -ne 0 ] && testing_addon_installed "${project_path}" ; then
        # Getting it again is how a project picks up a newer add-on, not what the setup needs: a fetch that failed
        # (a network hiccup, GitHub's rate limit) leaves the one the project has, and the setup goes on with it (#545).
        echo "";
        echo "  Getting the add-on again did not work (DDEV's words are above); this project already has it.";
        grep -qi 'rate limit' "${addon_log}" && echo "  GitHub answered with its rate limit: a token avoids it (export DDEV_GITHUB_TOKEN=\$(gh auth token))." ;
        local kept ; kept="$(testing_addon_version "${project_path}")" ;
        echo "  The setup goes on with the add-on it has${kept:+ (${kept})}; run it again later for a newer one.";
        rm -f "${addon_log}" ;
      elif [ "${addon_status}" -ne 0 ] ; then
        echo "";
        testing_addon_failure_says "${addon_log}" ;
        rm -f "${addon_log}" ;
        return 1 ;
      else
        rm -f "${addon_log}" ;
        # The add-on scaffolds on post-start, so the restart is part of the install, not a nicety.
        ddev restart || return 1 ;
        # The containers are up again; the app in them may not be yet, and the platform hooks below talk to it.
        testing_wait_for_site ;
      fi
      ;;
  esac

  # What a platform adds to the stack: its step pack in package.json and cucumber.js, its accounts in
  # the users registry. Before the dependencies are installed, so one install brings everything.
  testing_configure_plugins "${project_path}" ;

  runner="$(testing_package_runner "${project_path}")";
  if [ -f "${project_path}/package.json" ] ; then
    echo "";
    echo "Installing the JS dependencies and the chromium browser.";
    # A failed install leaves the project without webship-js or its step packs: say so and stop,
    # rather than calling the testing set up (the browser steps after it stay best-effort).
    if ! ddev ${runner} install ; then
      echo "";
      echo "  ${runner} install failed in ${doc_name}/${PROJECT_NAME}, so testing is not set up. Its error is above.";
      echo "  A package npm cannot find (a step pack not published yet, a mistyped name) is a common cause:";
      echo "  correct package.json, then run this command again.";
      return 1 ;
    fi
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

  # What the site shows (a generator meta tag, Bootstrap's CSS or JS on the front page) may say which
  # step pack fits it. Printed, never installed: adding one is the person's call.
  testing_steps_suggest "${project_path}" ;

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Testing is set up on ${doc_name}/${PROJECT_NAME} ($(testing_stack "${project_path}")).";
  echo "";
  echo "  Run it:      bash cmd-tools-testing.sh ${PROJECT_NAME} --run";
  echo "  One feature: bash cmd-tools-testing.sh ${PROJECT_NAME} --run --path tests/features/<name>.feature";
  echo "  By tag:      bash cmd-tools-testing.sh ${PROJECT_NAME} --run --tags @critical";
  echo "  Step packs:  bash cmd-tools-testing.sh ${PROJECT_NAME} --list-steps";
  echo "";
  echo "  The report lands in tests/reports/, and the dashboard's Tests menu reads it.";
  echo "*---------------------------------------------------------------------*";
}

# Start the project when it is not running; leave it alone when it is (see testing_run).
function testing_ensure_running() {
  if ddev describe -j 2>/dev/null | grep -q '"status":"running"' ; then
    return 0 ;
  fi
  ddev start -y ;
}

# The packs a project's package.json lists and node_modules does not hold yet, one per line.
function testing_steps_not_installed() {
  node "${TESTING_STEP_PACKS_JS}" missing "$1" 2>/dev/null ;
}

# Install the JS dependencies in the project's container: after a pack is added or taken out, so
# node_modules matches package.json (npm also prunes what is no longer listed).
function testing_steps_install() {
  local project_path="$1" runner;
  runner="$(testing_package_runner "${project_path}")";
  echo "";
  echo "Installing the JS dependencies in the container (ddev ${runner} install).";
  testing_ensure_running || return 1 ;
  ddev ${runner} install ;
}

# A suggestion, never an install: the pack that would fit what the site's front page shows.
function testing_steps_suggest() {
  local project_path="$1" lines;
  lines="$(timeout 40 node "${TESTING_STEP_PACKS_JS}" suggest "${project_path}" 2>/dev/null)" || return 0 ;
  [ -n "${lines}" ] || return 0 ;
  echo "";
  echo "A step pack that would fit this site (a suggestion: nothing is installed):";
  echo "${lines//<project>/${PROJECT_NAME}}";
}

# Every pack, with whether this project has it.
function testing_steps_list() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  testing_require_project "${project_path}" || return 1 ;
  echo "";
  node "${TESTING_STEP_PACKS_JS}" list "${project_path}" --label="${doc_name}/${PROJECT_NAME}" || return 1 ;
  echo "";
  echo "  Add:      bash cmd-tools-testing.sh ${PROJECT_NAME} --add-steps <name>[,<name>…]   (diffy, wordpress-steps or @webship-js/diffy-steps)";
  echo "            a pack not on npm yet: its tarball (npm pack) or its folder, e.g. --add-steps ../webship-js-x-steps-2.0.0.tgz";
  echo "  Examples: bash cmd-tools-testing.sh ${PROJECT_NAME} --examples <name>";
  echo "  Remove:   bash cmd-tools-testing.sh ${PROJECT_NAME} --remove-steps <name>";
}

# Add one or more packs: package.json and cucumber.js (step_packs.js add), then npm install in the
# container when something changed or a listed pack is not installed yet. Idempotent.
function testing_steps_add() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" before after status;
  testing_require_project "${project_path}" || return 1 ;
  if [ ! -f "${project_path}/package.json" ] || [ ! -f "${project_path}/cucumber.js" ] ; then
    if [ "$(testing_stack "${project_path}")" == 'in-project' ] ; then
      echo "${doc_name}/${PROJECT_NAME} sets its suite up with its own command (init-full-automated-testing), and has no" ;
      echo "  cucumber.js and package.json at its root: add the pack where its suite keeps them, by hand." ;
    else
      echo "${doc_name}/${PROJECT_NAME} has no webship-js stack yet (package.json and cucumber.js)." ;
      echo "  Set it up first: bash cmd-tools-testing.sh ${PROJECT_NAME}" ;
    fi
    return 1 ;
  fi
  # A pack given as a tarball or a folder (proven before it is on npm) is a path from where the command
  # was run: made absolute before the cd below. A name, @webship-js/<name>-steps included, stays a name.
  local item items=() ;
  IFS=',' read -ra items <<< "${ADD_STEPS}" ;
  ADD_STEPS="" ;
  for item in "${items[@]}" ; do
    item="${item#"${item%%[![:space:]]*}"}" ; item="${item%"${item##*[![:space:]]}"}" ;
    [ -n "${item}" ] || continue ;
    case "${item}" in
      @*) ;;
      */*|*.tgz) [ -e "${item}" ] && item="$(cd "$(dirname "${item}")" && pwd)/$(basename "${item}")" ;;
    esac
    ADD_STEPS="${ADD_STEPS:+${ADD_STEPS},}${item}" ;
  done
  cd "${project_path}" || return 1 ;
  echo "";
  echo "Adding step packs to ${doc_name}/${PROJECT_NAME}: ${ADD_STEPS}";
  before="$(cksum < package.json)";
  node "${TESTING_STEP_PACKS_JS}" add "${project_path}" "${ADD_STEPS}" ;
  status=$? ;
  after="$(cksum < package.json)";
  if [ "${before}" != "${after}" ] || [ -n "$(testing_steps_not_installed "${project_path}")" ] ; then
    testing_steps_install "${project_path}" || return 1 ;
  fi
  if [ ${status} -ne 0 ] ; then
    echo "";
    echo "  Not every pack could be added: the reason is above. What could be added was.";
    return ${status} ;
  fi
  echo "";
  echo "  Its examples: bash cmd-tools-testing.sh ${PROJECT_NAME} --examples <name>";
  echo "  Check the steps without a browser: bash cmd-tools-testing.sh ${PROJECT_NAME} --dry-run";
}

# Take out exactly what --add-steps put in, then npm install so node_modules follows package.json.
function testing_steps_remove() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" before after;
  testing_require_project "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
  echo "";
  echo "Taking step packs out of ${doc_name}/${PROJECT_NAME}: ${REMOVE_STEPS}";
  before="$(cksum < package.json 2>/dev/null)";
  node "${TESTING_STEP_PACKS_JS}" remove "${project_path}" "${REMOVE_STEPS}" || return 1 ;
  after="$(cksum < package.json 2>/dev/null)";
  if [ "${before}" != "${after}" ] ; then
    testing_steps_install "${project_path}" || return 1 ;
  fi
}

# Copy the example features a pack ships, never over a file. A pack in package.json that is not
# installed yet is installed first.
function testing_steps_examples() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" status;
  testing_require_project "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
  node "${TESTING_STEP_PACKS_JS}" examples "${project_path}" "${STEPS_EXAMPLES}" ;
  status=$? ;
  if [ ${status} -eq 4 ] && [ -n "$(testing_steps_not_installed "${project_path}")" ] ; then
    testing_steps_install "${project_path}" || return 1 ;
    node "${TESTING_STEP_PACKS_JS}" examples "${project_path}" "${STEPS_EXAMPLES}" ;
    status=$? ;
  fi
  if [ ${status} -eq 4 ] ; then
    echo "  Add it first: bash cmd-tools-testing.sh ${PROJECT_NAME} --add-steps ${STEPS_EXAMPLES}";
    return 1 ;
  fi
  [ ${status} -eq 0 ] || return ${status} ;
  echo "";
  echo "  Run one: bash cmd-tools-testing.sh ${PROJECT_NAME} --run --path tests/features/<pack>/<name>.feature";
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
  # The suite's address is LAUNCH_URL in the web container, which the webship-js add-on sets from the project's
  # primary URL. On a generic project whose router serves another service it comes out empty (#532), and the suite
  # would fall back to localhost: the run then passes the primary URL itself.
  if [ -z "$(ddev exec printenv LAUNCH_URL 2>/dev/null | tr -d '[:space:]')" ] ; then
    local primary ;
    primary="$(testing_primary_url)" ;
    [ -n "${primary}" ] && env_prefix="${env_prefix} LAUNCH_URL=${primary}" ;
  fi
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
  # A feature in the folder of a profile --add-steps made runs in that profile: its steps are not
  # loaded by the default one.
  local profile="${TESTING_PROFILE:-_none_}";
  if [ "${profile}" == '_none_' ] && [ ! "${TESTING_PATH}" == '_none_' ] ; then
    profile="$(node "${TESTING_STEP_PACKS_JS}" profile-for "${project_path}" "${TESTING_PATH}" 2>/dev/null)";
    [ "${profile}" == 'default' ] || [ -z "${profile}" ] && profile='_none_';
    [ "${profile}" == '_none_' ] || echo "  ${TESTING_PATH} belongs to the profile ${profile}: running with --profile ${profile}.";
  fi
  [ ! "${profile}" == '_none_' ] && filter="${filter} --profile \"${profile}\"";
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
    # cucumber-js never fails a dry run: it exits 0 with undefined or ambiguous steps, which are what a dry
    # run is there to find. Its summary line says how many, and they fail the run here (#486).
    if [ "${DRY_RUN}" == 'yes' ] ; then
      local unresolved ;
      unresolved="$(sed "s/$(printf '\033')\[[0-9;]*m//g" "${run_log}" | grep -E '^[0-9]+ steps? \(' | tail -1 \
        | grep -oE '[0-9]+ (undefined|ambiguous)' | tr '\n' ',' | sed 's/,$//; s/,/, /g')" ;
      if [ -n "${unresolved}" ] ; then
        echo "  Steps that do not resolve: ${unresolved}. A real run fails on them." ;
        [ "${status}" -eq 0 ] && status=1 ;
      fi
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
  if [ "${status}" -eq 0 ] && [ "${DRY_RUN}" == 'yes' ] ; then
    echo "  Every step resolves (a dry run, no browser) in $(( $(date +%s) - started ))s.";
  elif [ "${DRY_RUN}" == 'yes' ] ; then
    echo "  The dry run FAILED (exit ${status}) after $(( $(date +%s) - started ))s: the lines above say why.";
  elif [ "${status}" -eq 0 ] ; then
    echo "  The suite passed in $(( $(date +%s) - started ))s.";
  else
    # A failing suite is a result, not a tooling error — say so plainly and point at the evidence
    # rather than burying it in a non-zero exit.
    echo "  The suite FAILED (exit ${status}) after $(( $(date +%s) - started ))s.";
    echo "  Every failed step leaves a screenshot and a DOM dump; each scenario leaves a recording.";
  fi
  echo "";
  local others;
  others="$(node "${TESTING_STEP_PACKS_JS}" profiles "${project_path}" 2>/dev/null | tr '\n' ' ')";
  if [ -n "${others}" ] && [ "${profile}" == '_none_' ] ; then
    echo "  This ran the default profile. The project has others too: ${others}(--profile <name>).";
  fi
  echo "  Report:      ${doc_name}/${PROJECT_NAME}/tests/reports/cucumber_report.html";
  echo "  Screenshots: ${doc_name}/${PROJECT_NAME}/tests/screenshots/";
  echo "  Recordings:  ${doc_name}/${PROJECT_NAME}/tests/videos/";
  echo "  The dashboard's Tests menu shows all three, newest first.";
  echo "*---------------------------------------------------------------------*";
  return ${status} ;
}

function testing_command() {
  # The step-pack verbs are things to do of their own: with one of them, the setup only runs when asked.
  local steps='no';
  { [ "${LIST_STEPS}" == 'yes' ] || [ "${ADD_STEPS:-_none_}" != '_none_' ] || [ "${REMOVE_STEPS:-_none_}" != '_none_' ] \
    || [ "${STEPS_EXAMPLES:-_none_}" != '_none_' ] ; } && steps='yes';
  # --configure is the default, so it is only meaningful as a word — except together with --run,
  # where "set it up and then run it" is a real thing to ask for and used to lose the setup half.
  if [ "${CONFIGURE}" == 'yes' ] || { [ ! "${RUN}" == 'yes' ] && [ ! "${DRY_RUN}" == 'yes' ] && [ "${steps}" == 'no' ] ; } ; then
    testing_configure || return 1 ;
  fi
  [ "${LIST_STEPS}" == 'yes' ] && { testing_steps_list || return 1 ; }
  [ "${ADD_STEPS:-_none_}" != '_none_' ] && { testing_steps_add || return 1 ; }
  [ "${STEPS_EXAMPLES:-_none_}" != '_none_' ] && { testing_steps_examples || return 1 ; }
  [ "${REMOVE_STEPS:-_none_}" != '_none_' ] && { testing_steps_remove || return 1 ; }
  if [ "${RUN}" == 'yes' ] || [ "${DRY_RUN}" == 'yes' ] ; then
    testing_run ;
  fi
}
