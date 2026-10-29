#!/usr/bin/env bash

# A Webships Project build takes a name and which API site template to install.
#
# The installer lists the templates and applies the chosen one, so there is
# nothing else to decide: no profile, no extra packages, no modules to enable.

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
parser.add_argument('-p', '--php-version',
                    default="",
                    choices=['8.5', '8.4', '8.3', '8.2', '8.1', '8.0', '7.4'],
                    help='PHP version for the project container. The seven most recent PHP releases DDEV supports; empty means the builder default. Example: --php-version 8.3')
EOF
