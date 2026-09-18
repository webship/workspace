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
EOF
