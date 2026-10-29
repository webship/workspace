#!/usr/bin/env bash

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Add the install flag to install the project.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
parser.add_argument('-d', '--dev',
                    action='store_true',
                    default=False,
                    help='Build the development branch instead of the latest release.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Add default set of users to the project in the case of install')
parser.add_argument('-p', '--profile',
                    default="standard",
                    nargs='+',
                    choices=['standard', 'minimal', 'umami'],
                    help='Select which Drupal profile to install [default %(default)s]. Example: --profile minimal')
parser.add_argument('-r', '--require',
                    default="_none_",
                    nargs='+',
                    help='Require more modules/themes/libraries by composer. Example: --require "drupal/ctools:~3.0 drupal/token:~1.0"')
parser.add_argument('-e', '--enable',
                    default="_none_",
                    nargs='+',
                    help='Enable modules right after the install. Example: --enable "media media_library ctools token"')
parser.add_argument('--php-version',
                    default="",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
                    help='PHP version for the project container. The seven most recent PHP releases DDEV supports; empty means the builder default, and DDEV\'s own default under that. Example: --php-version 8.3')
EOF