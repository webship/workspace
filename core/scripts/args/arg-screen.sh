#!/usr/bin/env bash

# Arguments for running and managing detached screen sessions.
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('SESSION',
                    nargs='?',
                    default="_none_",
                    help='The screen session name (lowercase, digits, - _ .). Omit with --list.')
parser.add_argument('-r', '--run',
                    default="_none_",
                    help='Start the session detached, running this command; output goes to <workspace>/.screens/<session>.log. Example: --run "bash cmd-varbase11-0-x-project.sh demo1 --install"')
parser.add_argument('-l', '--list',
                    action='store_true',
                    default=False,
                    help='List the live sessions and whether each has a log.')
parser.add_argument('-o', '--log',
                    action='store_true',
                    default=False,
                    help='Print the session log (works after it finished too).')
parser.add_argument('-f', '--follow',
                    action='store_true',
                    default=False,
                    help='Follow the session log live until the session ends.')
parser.add_argument('-s', '--stop',
                    action='store_true',
                    default=False,
                    help='Stop the session (whatever runs inside it is killed).')
ARGEOF
