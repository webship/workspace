#!/usr/bin/env bash

# A site-template build takes a name and nothing else.
#
# The template decides what the site is — that is the whole point of one — so there is
# nothing left to choose: no profile, no extra packages, no modules to enable. The
# version is the latest release, the PHP version is the one DDEV picks, and the build
# runs the full three steps: the Drupal CMS codebase, the template, the install.

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site')
EOF
