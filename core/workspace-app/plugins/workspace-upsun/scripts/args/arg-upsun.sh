#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The project directory in this workspace.')
parser.add_argument('-l', '--link',
                    default="_none_",
                    help='Link the project to an Upsun project ID (upsun project:set-remote). Find IDs with: upsun projects')
parser.add_argument('-i', '--init',
                    action='store_true',
                    default=False,
                    help='Scaffold .upsun/config.yaml with upsun project:init (interactive).')
parser.add_argument('-p', '--push',
                    action='store_true',
                    default=False,
                    help='Deploy the current branch with upsun push. Outward-facing: upsun asks for confirmation.')
parser.add_argument('-e', '--environment',
                    default="_none_",
                    help='Environment for THIS run: the --push target, and the source --pull-db/--pull-files take data from. Default: the one remembered by --select.')
parser.add_argument('-E', '--environments',
                    action='store_true',
                    default=False,
                    help='List the environments (branches) of the linked Upsun project.')
parser.add_argument('-s', '--select',
                    default="_none_",
                    help='Remember which environment this project works against, in .upsun/local/ (git-excluded). The pulls then need no flag. Checked against the real environment list.')
parser.add_argument('-D', '--pull-db',
                    action='store_true',
                    default=False,
                    help='Dump the selected environment\'s database and import it into DDEV. REPLACES the local database — the current one is exported to backups/ first. Client data: it lands on this machine.')
parser.add_argument('-F', '--pull-files',
                    action='store_true',
                    default=False,
                    help='Download the selected environment\'s public files mount into the local docroot (adds and overwrites, never deletes). Client data.')
parser.add_argument('-g', '--logs',
                    action='store_true',
                    default=False,
                    help='Show the most recent deploy log.')
parser.add_argument('-a', '--activities',
                    action='store_true',
                    default=False,
                    help='List the last 10 Upsun activities.')
parser.add_argument('-B', '--no-safety-backup',
                    action='store_true',
                    default=False,
                    help='Skip exporting the local database before --pull-db replaces it. The export exists because a pull that ate an afternoon of work is a bad pull, so skipping it is a choice, not a default.')
parser.add_argument('-f', '--force',
                    action='store_true',
                    default=False,
                    help='Allow --link to relink a project that already points at a different Upsun ID.')
ARGEOF
