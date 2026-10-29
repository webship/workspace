#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Install WordPress, with the workspace account as the administrator.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
parser.add_argument('--php-version',
                    default="",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1'],
                    help='PHP version for the project container; empty means DDEV\'s default. Example: --php-version 8.3')
ARGEOF
