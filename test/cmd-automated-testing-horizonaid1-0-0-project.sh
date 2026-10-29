#!/usr/bin/env bash

# workspace-name: Horizon Aid ~1.0.0 on Varbase ~11 + Automated Functional Testing

# Build and install a Varbase 11 site with the Horizon Aid site template
# (https://www.drupal.org/project/horizonaid — the drupal/horizonaid Site recipe
# and its drupal/vartheme_bs5_horizonaid theme), scaffold the varbase-e2e
# automated-testing stack, then optionally run the suite.
#
# One run gives a site that is installed WITH the site template, has the test
# users, is tuned for testing, and has the Playwright browsers in place:
#
#   bash cmd-automated-testing-horizonaid1-0-x-project.sh myproject --run-headless
#
# The tests come from the site template's own suites where it ships them
# (recipes/horizonaid/tests/features), and otherwise from the project's
# tests/features. Pass a FEATURES glob to run one folder:
#
#   bash cmd-automated-testing-horizonaid1-0-x-project.sh myproject "tests/features/09-drupal-canvas/**/*.feature" -l
#
# test/cmd-vdo-automated-testing-varbase11-0-x-project.sh

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Set site version.
site_version="~11";
# Pinned to the released tag rather than the branch: `1-0-0` in the filename is `~1.0.0`,
# the same way `1-0-x` is `1.0.x-dev`.
horizonaid_version="~1.0.0";

ARGPARSE_DESCRIPTION="Build and install a Varbase ${site_version} + Horizon Aid ${horizonaid_version} site ready for automated testing with DDEV, then run the varbase-e2e suite (Playwright + Cucumber-js)."
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('FEATURES_PATH',
                    default='',
                    nargs='?',
                    help='A features glob to run instead of the whole suite. Example: "tests/features/09-drupal-canvas/**/*.feature"')
parser.add_argument('-r', '--run',
                    action='store_true',
                    default=False,
                    help='Run the automated test with a real browser. Shows the work of the driver on the browser.')
parser.add_argument('-b', '--run-no-headless',
                    action='store_true',
                    default=False,
                    help='Run a real no headless browser automated test. An alias for --run')
parser.add_argument('-l', '--run-headless',
                    action='store_true',
                    default=False,
                    help='Run a headless automated test. Hides the work of the driver on the browser.')
parser.add_argument('-n', '--no-headless',
                    action='store_true',
                    default=False,
                    help='Configure the test as a real browser with no headless automated test.')
parser.add_argument('-s', '--headless',
                    action='store_true',
                    default=False,
                    help='Configure the test as a headless automated test.')
parser.add_argument('-w', '--browser',
                    default="chromium",
                    help='Which browser to run the suite in: chromium, firefox or webkit [default %(default)s].')
parser.add_argument('-p', '--php-version',
                    default="8.4",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
                    help='PHP version for the DDEV project [default %(default)s]. The seven most recent PHP releases DDEV supports.')
EOF

shift $#;
trim_project_name ;   # "v11x00b1/" -> "v11x00b1" — see functions/fun-project-name.sh

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

base_url="https://${PROJECT_NAME}.ddev.site";
project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";

# Change directory to the workspace for this full operation.
cd ${WORKSPACE_ROOT}/${doc_name};

if [ -d "${PROJECT_NAME}" ]; then
  cd ${project_path} ;
  ddev delete -Oy 2>/dev/null || true ;
  cd ${WORKSPACE_ROOT}/${doc_name} ;
  rm -rf ${PROJECT_NAME} ;
fi

# Create the project directory.
mkdir -p ${PROJECT_NAME} ;
cd ${project_path} ;

# Configure DDEV for Drupal 11 with web docroot, PHP 8.4 and MariaDB 10.11. The database version is chosen here, before the
# first start, because a volume made at DDEV's own default (11.8) refuses to start again under the 10.11 the template pins.
ddev config --project-type=drupal11 --docroot=web --php-version=${PHP_VERSION} --database=mariadb:10.11 --project-name=${PROJECT_NAME} --auto ;
ddev_telemetry_off ;
ddev start ;

# Create the Varbase 11 project via composer inside DDEV. The trailing `.` keeps
# the project in this directory instead of a varbase_project/ subfolder.
ddev composer create-project drupal/varbase_project:${site_version} . --no-interaction ;

# The project template ships its own .ddev config and overwrites ours: keep the
# database we provisioned and re-assert the PHP version.
ddev config --database=mariadb:10.11 --php-version=${PHP_VERSION} ;
ddev_telemetry_off ;

# Chromium keeps its renderer heap in /dev/shm. DDEV's default 64M makes a long
# Playwright run die with exit 137 (out of memory), so give the web container 2G.
mkdir -p ${project_path}/.ddev ;
cat > ${project_path}/.ddev/docker-compose.shm.yaml <<'SHMEOF'
services:
  web:
    shm_size: 2gb
SHMEOF

# Chromium's runtime libraries are not in the DDEV web image: without them
# Playwright fails to launch with "libnspr4.so: cannot open shared object file".
ddev config --webimage-extra-packages="libnss3,libnspr4,libatk1.0-0,libatk-bridge2.0-0,libcups2,libdrm2,libxkbcommon0,libxcomposite1,libxdamage1,libxfixes3,libxrandr2,libgbm1,libpango-1.0-0,libcairo2,libasound2,libatspi2.0-0,libx11-xcb1,fonts-liberation" ;
ddev_telemetry_off ;
ddev restart ;

# Add the Horizon Aid site template before the install, so the installer can see
# it as a site template choice.
ddev composer require "drupal/horizonaid:${horizonaid_version}" --no-interaction ;

# Install Varbase with the Horizon Aid site template chosen non-interactively:
# Varbase asks that question from \Drupal\varbase\Installer\Form\SiteTemplateForm,
# whose form id and `add_ons` element match Drupal CMS's installer.
ddev drush site:install varbase --yes \
  installer_site_template_form.add_ons=horizonaid \
  --site-name="Horizon Aid" \
  --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" \
  --locale="en" ;

# Scaffold the varbase-e2e stack (Playwright + Cucumber-js), add the test users
# and make the site test-ready: antibot off, aggregation off, verbose logging,
# flood table cleared. Tests fail on a stock site without this prep.
ddev init-full-automated-testing ;

# Install JS dependencies and the Playwright browsers.
ddev yarn install ;
ddev npx playwright install-deps ${BROWSER} ;
ddev npx playwright install ${BROWSER} ;

build_time=$( date '+%Y-%m-%d %H-%M-%S' );
echo "// Built time: ${build_time}" >> ${project_path}/web/sites/default/settings.php 2>/dev/null || true ;

# Prefer the site template's own suites when it ships them: the .feature files
# are moving into the Horizon Aid recipe.
features_path="${FEATURES_PATH}";
if [ -z "${features_path}" ] && [ -d "${project_path}/recipes/horizonaid/tests/features" ]; then
  features_path="recipes/horizonaid/tests/features/**/*.feature";
  echo "Running the Horizon Aid site template's own suites: ${features_path}";
fi

# Rebuild caches and tune for testing.
ddev drush config:set system.performance css.preprocess 0 --yes ;
ddev drush config:set system.performance js.preprocess 0 --yes ;
ddev drush config:set system.logging error_level all --yes ;
ddev drush cache:rebuild ;

# Send a notification.
echo "${doc_name} ${PROJECT_NAME} (Varbase ${site_version} + Horizon Aid ${horizonaid_version}) is ready!!!!";
echo "-----------------------------------------";
echo " ${base_url}";
echo "-----------------------------------------";
echo " Change directory to the project:"
echo " cd ${project_path}";
echo "-----------------------------------------";
echo " To run the full varbase-e2e suite:";
echo " ddev yarn test:${BROWSER}";
echo "-----------------------------------------";
echo " To run one suite folder (the env var has to be set inside the container):";
echo " ddev exec 'FEATURES=\"tests/features/09-drupal-canvas/**/*.feature\" yarn test:${BROWSER}'";
echo "-----------------------------------------";
echo " To build the HTML + PDF reports from the run:";
echo " ddev yarn generate-reports";
echo "-----------------------------------------";

## Run the automated test suite. FEATURES and HEADLESS are read by cucumber.js,
## so they have to be set inside the web container, not on the host.
if $run_automated_testing ; then
  cd ${project_path} ;
  test_env="";
  if [ -n "${features_path}" ]; then
    test_env="FEATURES=\"${features_path}\" ";
  fi
  if ! $headless ; then
    test_env="${test_env}HEADLESS=false ";
  fi
  ddev exec "${test_env}yarn test:${BROWSER}" ;
  ddev yarn generate-reports || true ;
fi

cd ${WORKSPACE_ROOT}/${doc_name};
