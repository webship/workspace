#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='Which Milvus instance to back up. Default: milvus.project from the workspace settings.')
ARGEOF
