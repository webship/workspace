#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='The Penpot instance to back up. Default: penpot.project from the workspace settings.')
ARGEOF
