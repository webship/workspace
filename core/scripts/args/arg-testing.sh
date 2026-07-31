#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The project to set up testing on, or to test.')
parser.add_argument('-r', '--run',
                    action='store_true',
                    default=False,
                    help='Run the suite instead of setting it up. Without this the command configures the testing environment (idempotent — it adds what is missing and preserves what is there).')
parser.add_argument('-c', '--configure',
                    action='store_true',
                    default=False,
                    help='Set up (or re-apply) the testing environment. This is what the command does by default; the flag is here so a run reads as one.')
parser.add_argument('-b', '--browser',
                    default="chromium",
                    choices=['chromium', 'firefox', 'webkit'],
                    help='Which browser the package script runs [default %(default)s].')
parser.add_argument('-p', '--path',
                    dest='TESTING_PATH',
                    default="_none_",
                    help='Run one feature file or directory instead of the whole suite. Example: --path tests/features/check-homepage.feature')
parser.add_argument('-H', '--headed',
                    action='store_true',
                    default=False,
                    help='Run with a visible browser (HEADLESS=false), for watching a scenario fail.')
parser.add_argument('-d', '--dry-run',
                    action='store_true',
                    default=False,
                    help='Compile the suite and match every step against the definitions without opening a browser. Seconds instead of the ~20 minutes a full suite takes, and it is what catches an undefined step or a broken tag expression.')
parser.add_argument('-R', '--retry',
                    default="_none_",
                    help='Retry a failing scenario N times. The projects here already set retry: 1 in cucumber.js; this overrides it for one run.')
parser.add_argument('-t', '--tags',
                    default="_none_",
                    help='Run only the scenarios carrying a Cucumber tag expression. Example: --tags "@critical and not @wip"')
ARGEOF
