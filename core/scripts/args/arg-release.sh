#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-t', '--tag',
                    default='',
                    help='The tag to cut. Default: the newest one with its last segment bumped.')
parser.add_argument('-b', '--branch',
                    default='1.0.x',
                    help='The branch to release from.')
parser.add_argument('-n', '--notes',
                    default='',
                    help='A file holding the release notes. Without one the notes are generated and have to be written over.')
parser.add_argument('-g', '--no-gate',
                    action='store_true',
                    default=False,
                    help='Skip the smoke test and the unit tests. For a release that has already been gated elsewhere.')
parser.add_argument('-c', '--confirm',
                    action='store_true',
                    default=False,
                    help='Actually cut it. Without this the plan is printed and nothing is created.')
ARGEOF
