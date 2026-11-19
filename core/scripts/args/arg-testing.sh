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
parser.add_argument('--profile',
                    dest='TESTING_PROFILE',
                    metavar='NAME',
                    default="_none_",
                    help='Run a profile of cucumber.js other than the default one: the profile --add-steps gives a second platform pack. A --path inside that profile\'s folder picks it by itself.')
parser.add_argument('--list-steps',
                    action='store_true',
                    default=False,
                    help='List every webship-js extra-steps pack (@webship-js/*-steps on npm, kept for a day; the list shipped with the Workspace when npm cannot be reached): its version, what it is for, its docs page, and whether this project has it.')
parser.add_argument('--add-steps',
                    dest='ADD_STEPS',
                    metavar='PACKS',
                    default="_none_",
                    help='Add one or more step packs, comma-separated: the dev dependency at its latest release line, its step definitions in cucumber.js after webship-js\'s own (a second platform pack gets a profile of its own), then npm install in the container. Example: --add-steps diffy,wordpress')
parser.add_argument('--remove-steps',
                    dest='REMOVE_STEPS',
                    metavar='PACKS',
                    default="_none_",
                    help='Take out exactly what --add-steps put in for one or more packs (comma-separated), and nothing else. Example: --remove-steps diffy')
parser.add_argument('--examples',
                    dest='STEPS_EXAMPLES',
                    metavar='PACKS',
                    default="_none_",
                    help='Copy the example features a pack ships into tests/features/<pack>/, never over a file (comma-separated for several). Example: --examples wordpress')
ARGEOF
