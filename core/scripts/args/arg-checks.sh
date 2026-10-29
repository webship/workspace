#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The project, product, module, theme, recipe or library to check.')
parser.add_argument('-l', '--list',
                    action='store_true',
                    default=False,
                    help='Print the plan — every check, the script the package declares for it, the command it would run, the package manager and where it would run — and stop. Runs nothing and needs no dependencies, so it is the fastest way to see what a package actually covers.')
parser.add_argument('-o', '--only',
                    default="_none_",
                    help='Run only these checks, comma separated. Ids: format, js, css, yaml, spelling, types, php, twig, e2e. Example: --only js,css')
parser.add_argument('-s', '--skip',
                    default="_none_",
                    help='Skip these checks, comma separated. Applied after --only. Example: --skip spelling')
parser.add_argument('-e', '--e2e',
                    action='store_true',
                    default=False,
                    help='Include the browser suite. Off by default: it needs a running site to point a browser at, and it takes minutes. On a site this hands over to cmd-tools-testing.sh rather than reimplementing it.')
parser.add_argument('-b', '--browser',
                    default="chromium",
                    choices=['chromium', 'firefox', 'webkit'],
                    help='Which browser the e2e check asks for [default %(default)s].')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Install the package dependencies first when they are missing. Off by default because installing runs the package own postinstall and prepare scripts, and several packages here write into a docroot from theirs.')
parser.add_argument('-r', '--runner',
                    default="_none_",
                    choices=['npm', 'yarn'],
                    help='Force the package manager instead of reading packageManager and the lockfiles. Needed only where a package carries both lockfiles.')
parser.add_argument('-F', '--fail-fast',
                    action='store_true',
                    default=False,
                    help='Stop at the first failing check. By default every check runs and the command exits once at the end, so one failure does not hide the rest.')
ARGEOF
