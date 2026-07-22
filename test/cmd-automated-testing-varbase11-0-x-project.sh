#!/bin/usr/env bash

# workspace-name: Varbase 11.0.x + Automated Testing (webship-js)

# Build a Varbase 11.0.x project in the test workspace, install it, then run
# its bundled webship-js (Playwright + Cucumber-js) suite from the host
# against https://<PROJECT_NAME>.ddev.site. Varbase 11 ships the suite in
# tests/features with `npm test`; LAUNCH_URL drives the target site.

# Bootstrap.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Set site version.
site_version="11.0.x-dev";

# Load distribution configs.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/distributions/varbase.yml);

ARGPARSE_DESCRIPTION="Build a ${distribution_title} ${site_version} project and run its webship-js automated tests"
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('TESTING_PATH',
                    default='tests/features',
                    nargs='?',
                    help='Feature path to run. default [ tests/features ]')
parser.add_argument('-t', '--tags',
                    default='',
                    help='Optional cucumber tags filter, e.g. --tags "@critical"')
parser.add_argument('-r', '--run',
                    action='store_true',
                    default=False,
                    help='Run with a real visible browser (headed).')
parser.add_argument('-b', '--run-no-headless',
                    action='store_true',
                    default=False,
                    help='Alias for --run: real, no-headless browser.')
parser.add_argument('-l', '--run-headless',
                    action='store_true',
                    default=False,
                    help='Run headless (the default).')
parser.add_argument('-s', '--skip-build',
                    action='store_true',
                    default=False,
                    help='Skip the build+install (test an already-built project)')
ARGEOF

shift $#;

INSTALL='yes';
REQUIRE='_none_';
ENABLE='_none_';

if [ ! "${SKIP_BUILD}" == 'yes' ]; then
  # Build the distribution (includes install).
  build_distribution ;
fi

# Run the bundled webship-js suite from the host against the DDEV site.
cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

echo "Installing test dependencies (npm + Playwright chromium)…" ;
npm install --no-audit --no-fund ;
npx playwright install chromium ;

export LAUNCH_URL="https://${PROJECT_NAME}.ddev.site" ;

# Headed vs headless: --run / --run-no-headless show the browser;
# headless is the default (and what --run-headless selects).
if [ "${RUN}" == 'yes' ] || [ "${RUN_NO_HEADLESS}" == 'yes' ]; then
  export HEADLESS=false ;
else
  export HEADLESS=true ;
fi

echo "Running webship-js suite against ${LAUNCH_URL} (HEADLESS=${HEADLESS}, path=${TESTING_PATH})" ;
if [ -n "${TAGS}" ]; then
  npm test -- "${TESTING_PATH}" --tags "${TAGS}" ;
else
  npm test -- "${TESTING_PATH}" ;
fi
