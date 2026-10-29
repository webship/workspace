#!/usr/bin/env bash

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Add the install flag to install the project.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Add default set of users to the project in the case of install')
parser.add_argument('--php-version',
                    default="",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
                    help='PHP version for the project container. The seven most recent PHP releases DDEV supports; empty means the builder default. Example: --php-version 8.3')
EOF
