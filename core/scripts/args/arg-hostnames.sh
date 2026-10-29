#!/usr/bin/env bash

# Arguments for a project's extra hostnames. Reporting is the default and the
# only thing that happens without a flag: this writes DDEV configuration, so
# nothing changes because somebody asked a question.
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    default='_none_',
                    nargs='?',
                    help='The project. Omit to list every project in this workspace and the addresses it answers at.')
parser.add_argument('-a', '--add',
                    default="_none_",
                    help='Add a hostname label (no dots — the project TLD is appended). Example: --add test3-dev')
parser.add_argument('-w', '--with-workspace',
                    action='store_true',
                    help='Add <project>-<workspace>, so the same project name in two workspaces gets two flat addresses (test3-dev.ddev.site, test3-test.ddev.site).')
parser.add_argument('-r', '--remove',
                    default="_none_",
                    help='Remove one of the additional hostnames. The canonical one cannot be removed — it comes from the project name.')
parser.add_argument('-s', '--start',
                    action='store_true',
                    help='Run ddev start afterwards, which is what actually pushes the new route to the router.')
EOF
