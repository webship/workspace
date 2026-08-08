#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site')
parser.add_argument('-v', '--site-template-version',
                    default="",
                    help='Composer constraint for the site template. Example: --site-template-version "^1.0". Default: the latest release.')
parser.add_argument('-p', '--php-version',
                    default="8.3",
                    help='PHP version for the DDEV project [default %(default)s].')
parser.add_argument('-s', '--skip-install',
                    action='store_true',
                    default=False,
                    help='Build the codebase only, and pick the site template in the browser installer instead.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
parser.add_argument('-r', '--require',
                    default="_none_",
                    nargs='+',
                    help='Require more packages by composer. Example: --require "drupal/token:~1.0"')
ARGEOF
