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
parser.add_argument('TESTING_TAGS',
                    default='',
                    nargs='?',
                    help='Optional cucumber tags to filter, e.g. "@critical"')
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
echo "Running webship-js suite against ${LAUNCH_URL}" ;
if [ -n "${TESTING_TAGS}" ]; then
  npm test -- --tags "${TESTING_TAGS}" ;
else
  npm test ;
fi
