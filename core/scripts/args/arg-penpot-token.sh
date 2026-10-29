#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='The Penpot instance to create the token on. Default: penpot.project from the workspace settings.')
parser.add_argument('-t', '--token-name',
                    default="drupal ai_penpot",
                    help='Name the token carries in Penpot [default %(default)s].')
parser.add_argument('-m', '--email',
                    default="_settings_",
                    help='Account to create the token for. Default: penpot.account.email, then account.mail.')
parser.add_argument('-p', '--password',
                    default="_settings_",
                    help='Password for that account. Default: penpot.account.password, then account.pass.')
ARGEOF
