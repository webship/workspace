#!/usr/bin/env bash

# Arguments for proposing one agent, skill or prompt back to the shared repository.
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('NAME',
                    help='The item to propose, by the name the dashboard shows.')
parser.add_argument('-s', '--summary',
                    default='',
                    help='One line on what it is for. It becomes the issue and the pull request description.')
parser.add_argument('-y', '--confirm',
                    action='store_true',
                    default=False,
                    help='Actually hand it over. Without this the plan is printed and nothing is created.')
ARGEOF
