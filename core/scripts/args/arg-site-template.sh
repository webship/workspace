#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site')
parser.add_argument('-v', '--site-template-version',
                    default="",
                    help='Composer constraint for the site template. Example: --site-template-version "^1.0". Default: the constraint in this command\'s name.')
parser.add_argument('-p', '--php-version',
                    default="8.4",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
                    help='PHP version for the DDEV project [default %(default)s]. The seven most recent PHP releases DDEV supports.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Install the site template after building. Without it the build stops at a codebase, and the site template is picked in the browser installer.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
parser.add_argument('-r', '--require',
                    default="_none_",
                    nargs='+',
                    help='Require more packages by composer. Example: --require "drupal/token:~1.0"')
ARGEOF
