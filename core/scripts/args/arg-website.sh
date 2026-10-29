#!/usr/bin/env bash

# The Website project template (drupal/website) is installed by the Webship
# installer, which offers the three Webship site templates. Pick one.

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site')
parser.add_argument('-t', '--template',
                    default="website_starter",
                    choices=['website_starter', 'webship_starter', 'webship_portal'],
                    help='The site template the Webship installer installs [default %(default)s].')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Add the default set of users after the install.')
parser.add_argument('-f', '--with-pending-fixes',
                    action='store_true',
                    default=False,
                    help='Pin the web* issue-fork branches that are not merged yet (webblog MR !4, webreleases MR !5).')
parser.add_argument('-p', '--php-version',
                    default="",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
                    help='PHP version for the project container. The seven most recent PHP releases DDEV supports; empty means the builder default. Example: --php-version 8.3')
EOF
