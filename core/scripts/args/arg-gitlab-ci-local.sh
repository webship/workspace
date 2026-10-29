#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The project directory in this workspace (a git clone with a .gitlab-ci.yml).')
parser.add_argument('JOB',
                    default='_none_',
                    nargs='?',
                    help='One job to run by name. Default: the whole pipeline.')
parser.add_argument('-l', '--list',
                    action='store_true',
                    default=False,
                    help='List the jobs and their stages instead of running.')
parser.add_argument('-s', '--slim',
                    action='store_true',
                    default=False,
                    help='Run the project\'s committed .gitlab-ci-local.yml (the reproducible subset) instead of the full pipeline.')
parser.add_argument('-v', '--variable',
                    default="_none_",
                    help='Pass one variable through, e.g. --variable DRUPAL_CORE=11.4.0')
parser.add_argument('-d', '--doctor',
                    action='store_true',
                    default=False,
                    help='Only check the setup: gitlab-ci-local, the drupal-ci-local wrapper, Docker, SSH to git.drupal.org.')
ARGEOF
