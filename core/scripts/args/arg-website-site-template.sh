#!/usr/bin/env bash

# A Website/Webship site-template recipe applied on a plain Drupal 11.4.x
# recommended project. The recipe decides what the site is.

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Add the default set of users after the install.')
parser.add_argument('-f', '--with-pending-fixes',
                    action='store_true',
                    default=False,
                    help='Pin the web* issue-fork branches that are not merged yet (webblog MR !4, webreleases MR !5).')
EOF
