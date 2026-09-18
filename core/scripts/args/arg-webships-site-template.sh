#!/usr/bin/env bash

# An API site-template build takes a name, and whether to add the default users.
#
# The template decides what the site is — that is the whole point of one — so there is
# nothing left to choose: no profile, no extra packages, no modules to enable. The
# version is set by the calling builder, and the PHP version is pinned to the one the
# API line is tested on.

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Add the default set of users to the installed site.')
EOF
