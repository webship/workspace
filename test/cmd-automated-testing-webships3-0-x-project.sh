#!/usr/bin/env bash

# workspace-name: Webships 3.0.x + Automated Testing (webship-js)

# Build a Webships 3.0.x API site with DDEV, install it with an API site
# template, then check what the built site actually serves and optionally run the
# webship-js (Playwright + Cucumber-js) suite.
#
#   bash cmd-automated-testing-webships3-0-x-project.sh myapi
#   bash cmd-automated-testing-webships3-0-x-project.sh myapi --template webapi_starter --run
#
# The assertions below read the installed site rather than the recipe files: a
# saved recipe is not evidence that a site installed correctly.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.test.settings.yml);

# Set the version of the project template.
site_version="1.0.x-dev";

# Distribution.
distribution_name="webships";
distribution_title="Webships";
distribution_webroot="web";
distribution_profile_repo="webship/webships";
distribution_project_template="drupal/webships_project";

ARGPARSE_DESCRIPTION="Build and test a ${distribution_title} 3.0.x API project with webship-js"
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site')
parser.add_argument('-t', '--template',
                    default='webships_starter',
                    help='The API site template to install: webships_starter or webapi_starter. default [ webships_starter ]')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Add the default set of users to the installed site.')
parser.add_argument('-r', '--run',
                    action='store_true',
                    default=False,
                    help='Run the webship-js suite after the install, in a real browser.')
parser.add_argument('-l', '--run-headless',
                    action='store_true',
                    default=False,
                    help='Run the webship-js suite after the install, headless.')
parser.add_argument('-p', '--php-version',
                    default="8.4",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
                    help='PHP version for the project container [default %(default)s].')
EOF

shift $#;

# Build and install, and stop here when that fails: every assertion below assumes
# a site that finished installing.
build_webships_project || exit 1 ;

cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;

echo "";
echo "*---------------------------------------------------------------------*";
echo "  Checking what the installed site serves";
echo "*---------------------------------------------------------------------*";

failures=0 ;

# JSON:API must be read-only. A site template that turned writes on is a finding,
# not a preference.
read_only=$(ddev drush config:get jsonapi.settings read_only --format=string 2>/dev/null) ;
echo "jsonapi.settings read_only : ${read_only:-<unset>}" ;
if [ "${read_only}" != "true" ] && [ "${read_only}" != "1" ]; then
  echo "  FAIL: JSON:API is not read-only." ;
  failures=$((failures+1)) ;
fi

# The API module itself has to be enabled, or the recipe never ran.
if ddev drush pm:list --status=enabled --format=list 2>/dev/null | grep -qx "webapi" ; then
  echo "webapi module               : enabled" ;
else
  echo "  FAIL: the webapi module is not enabled." ;
  failures=$((failures+1)) ;
fi

# Both theme slots are set and the themes are installed (the template ships UIkit Admin and
# UI Suite UIkit; an older template used the core administration theme for both).
admin_theme=$(ddev drush config:get system.theme admin --format=string 2>/dev/null) ;
default_theme=$(ddev drush config:get system.theme default --format=string 2>/dev/null) ;
enabled_themes=$(ddev drush pm:list --type=theme --status=enabled --format=list 2>/dev/null) ;
echo "system.theme admin          : ${admin_theme:-<unset>}" ;
echo "system.theme default        : ${default_theme:-<unset>}" ;
for slot_theme in "${admin_theme}" "${default_theme}" ; do
  if [ -z "${slot_theme}" ] || ! printf '%s\n' "${enabled_themes}" | grep -qx "${slot_theme}" ; then
    echo "  FAIL: theme '${slot_theme:-<unset>}' is not set or not installed." ;
    failures=$((failures+1)) ;
  fi
done

# The API answers from /api, and the entry point needs no authentication.
api_status=$(ddev exec curl -s -o /dev/null -w "%{http_code}" http://localhost/api 2>/dev/null) ;
echo "GET /api                    : ${api_status:-no response}" ;
if [ "${api_status}" != "200" ]; then
  echo "  FAIL: /api did not answer with 200." ;
  failures=$((failures+1)) ;
fi

echo "";
if [ ${failures} -gt 0 ]; then
  echo "${failures} check(s) failed. The site is installed; read the failures above." ;
else
  echo "All checks passed." ;
fi

# Run the webship-js suite when asked for.
if [ "$RUN" == 'yes' ] || [ "$RUN_HEADLESS" == 'yes' ]; then
  echo "";
  echo "Running the webship-js suite." ;
  if [ -f cucumber.js ]; then
    ddev exec ./node_modules/.bin/cucumber-js --config cucumber.js --tags "not @wip" ;
  else
    echo "No cucumber.js in this project: the API templates ship no browser suite yet." ;
    echo "Scaffold one with the webship-js tooling before using --run." ;
  fi
fi

cd ${WORKSPACE_ROOT}/${doc_name} ;
exit ${failures} ;
