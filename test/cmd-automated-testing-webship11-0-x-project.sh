#!/bin/usr/env bash

# workspace-name: Webship 11.0.x + Automated Testing (webship-js)

# Build a Webship 11.0.x project with DDEV, install the site, scaffold the
# automated-testing stack, then optionally run the webship-js (Playwright +
# Cucumber-js) suite.
#
# Logic follows the webship/vdo-project 11.0.x automated-testing builders.
# https://github.com/webship/vdo-project/issues/50

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Set site version.
site_version="11.0.x-dev";

# Distribution.
distribution_name="webship";
distribution_title="Webship";
distribution_profile="webship";
distribution_webroot="web";
distribution_profile_repo="drupal/webship";
distribution_project_template="drupal/webship_project";

ARGPARSE_DESCRIPTION="Add new Webship ${site_version} ready Automated testing builds with DDEV, and install. Then run tests using webship-js (Playwright + Cucumber-js)."
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('TESTING_PATH',
                    default='tests/features/webship',
                    nargs='?',
                    help='Testing path. default value [ tests/features/webship ]')
parser.add_argument('-r', '--run',
                    action='store_true',
                    default=False,
                    help='Run the automate test with real browser. Shows the work of the driver on the browser.')
parser.add_argument('-b', '--run-no-headless',
                    action='store_true',
                    default=False,
                    help='Run a real no headless browser automate test. An alies for --run')
parser.add_argument('-l', '--run-headless',
                    action='store_true',
                    default=False,
                    help='Run a headless automate test. Hides the work of the driver on the browser.')
parser.add_argument('-n', '--no-headless',
                    action='store_true',
                    default=False,
                    help='Configure the test as a real browser with no headless automate test.')
parser.add_argument('-s', '--headless',
                    action='store_true',
                    default=False,
                    help='Configure the test as a headless automate test.')
EOF

shift $#;

# Default values.
run_automated_testing=false;
headless=true;

if [ "$RUN" == 'yes' ]; then
  run_automated_testing=true;
  headless=false;
fi

if [ "$RUN_NO_HEADLESS" == 'yes' ]; then
  run_automated_testing=true;
  headless=false;
fi

if [ "$RUN_HEADLESS" == 'yes' ]; then
  run_automated_testing=true;
  headless=true;
fi

if [ "$HEADLESS" == 'yes' ]; then
  headless=true;
fi

if [ "$NO_HEADLESS" == 'yes' ]; then
  headless=false;
fi

# Change directory to the workspace for this full operation.
cd ${WORKSPACE_ROOT}/${doc_name};

if [ -d "${PROJECT_NAME}" ]; then
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;
  ddev delete -Oy 2>/dev/null || true ;
  cd ${WORKSPACE_ROOT}/${doc_name} ;
  rm -rf ${PROJECT_NAME} ;
fi

# Create the project directory.
mkdir ${PROJECT_NAME} ;
cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

# Configure DDEV for Drupal 11 with web docroot and PHP 8.4.
ddev config --project-type=drupal11 --docroot=web --php-version=8.4 --project-name=${PROJECT_NAME} --auto ;
ddev start ;

# Create the Webship 11 project via composer inside DDEV.
ddev composer create-project ${distribution_project_template}:${site_version} --no-interaction ;

# The project template ships its own .ddev config that changes the database and
# webimage packages after our initial ddev config. Re-align exactly as
# build_distribution does: keep the database we already provisioned and drop the
# optional apt extras, whose third-party repo keys break apt in the container.
# Pin node 22 while doing it: webship_project's package.json requires node
# >= 20, and DDEV's default is still 18, so yarn install would fail with
# "The engine node is incompatible with this module".
ddev config --database=mariadb:10.11 --webimage-extra-packages="" --nodejs-version=22 ;
ddev restart ;

# Install the site, then scaffold the testing stack. The in-repo ddev command
# does both when the project template ships it; otherwise install with drush
# and let the steps below set the JS side up.
if ddev exec test -f .ddev/commands/web/init-full-automated-testing 2>/dev/null ; then
  ddev init-full-automated-testing ;
else
  ddev drush site:install ${distribution_profile} --yes \
    --account-name="${account_name}" --account-pass="${account_pass}" \
    --account-mail="${account_mail}" --site-name="${PROJECT_NAME}" --locale=en \
    install_configure_form.enable_update_status_emails=NULL ;
fi

# Point webship-js at this project's own URL, so the suite needs no manual
# environment: its default LAUNCH_URL is http://localhost:8080. Written as a
# merged config file rather than `ddev config`, which would also re-apply the
# project template's own .ddev/config.yaml (a different database type) over
# the containers this build already created.
cat > .ddev/config.webship-js.yaml <<YAML
web_environment:
  - LAUNCH_URL=https://${PROJECT_NAME}.ddev.site
YAML
ddev restart ;

# Install JS dependencies and the Playwright browser webship-js drives. Test
# binaries are run from node_modules/.bin, never through npx: when a binary is
# missing npx silently installs a same-named package from the registry.
if ! ddev yarn install ; then
  echo "yarn install failed — the webship-js suite cannot run in this build." ;
  exit 1 ;
fi

# cucumber.js loads ts-node/register, which webship_project does not list as a
# dependency yet — add it when it is missing so the runner can start.
ddev exec test -d node_modules/ts-node || ddev yarn add -D ts-node ;

# The chromium system libraries. install-deps runs apt, which fails while a
# third-party repo with an expired signing key is enabled, so park those repos
# for the run and put them back afterwards.
ddev exec sudo sh -c 'mkdir -p /tmp/apt-off && mv /etc/apt/sources.list.d/php.list /tmp/apt-off/ 2>/dev/null ; apt-get update -qq >/dev/null 2>&1 ; ./node_modules/.bin/playwright install-deps chromium ; mv /tmp/apt-off/php.list /etc/apt/sources.list.d/ 2>/dev/null' ;
ddev exec ./node_modules/.bin/playwright install chromium ;

build_time=$( date '+%Y-%m-%d %H-%M-%S' );
echo "// Built time: ${build_time}" >> ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/web/sites/default/settings.php 2>/dev/null || true ;

# Toggle headless mode in the Playwright config if present.
playwright_config="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/playwright.config.ts" ;
if [ -f "${playwright_config}" ]; then
  if ! $headless ; then
    sed -i "s,headless: true,headless: false,g" ${playwright_config} ;
  else
    sed -i "s,headless: false,headless: true,g" ${playwright_config} ;
  fi
fi

# Rebuild caches and tune for testing.
ddev drush config:set system.performance css.preprocess 0 --yes ;
ddev drush config:set system.performance js.preprocess 0 --yes ;
ddev drush config:set system.logging error_level all --yes ;
ddev drush cache:rebuild ;

# Send a notification.
echo "${doc_name} ${PROJECT_NAME} (Webship ${site_version}) has been installed!!!!";
echo "-----------------------------------------";
echo " Change directory to the project:"
echo " cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
echo "-----------------------------------------";
echo " To run the full webship-js suite (chromium is the default browser):";
echo " ddev exec ./node_modules/.bin/cucumber-js --config cucumber.js";
echo "-----------------------------------------";
echo " To run a specific test path:";
echo " ddev exec ./node_modules/.bin/cucumber-js --config cucumber.js ${TESTING_PATH}";
echo "-----------------------------------------";
echo " The HTML report is written to tests/reports/cucumber_report.html";
echo "-----------------------------------------";
cd ${WORKSPACE_ROOT}/${doc_name};

## Run the full automated test.
if $run_automated_testing ; then
  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;
  ddev exec ./node_modules/.bin/cucumber-js --config cucumber.js ;
fi
