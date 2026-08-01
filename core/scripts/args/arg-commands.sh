#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-l', '--list',
                    action='store_true',
                    default=False,
                    help='List every cmd-*.sh in the workspace. This is also the default.')
parser.add_argument('-w', '--workspace',
                    default='_all_',
                    help='Limit --list to one workspace, or say where --new and --clone put the copy. default [ _all_ ]')
parser.add_argument('-r', '--list-remote',
                    action='store_true',
                    default=False,
                    help='List what the tooling repository has, and whether this machine has it, the same, or different.')
parser.add_argument('-p', '--pull',
                    default='_none_',
                    help='Bring one cmd-*.sh down from the tooling repository into the workspace folder it belongs to.')
parser.add_argument('-d', '--diff',
                    default='_none_',
                    help='Show one cmd-*.sh on this machine against the copy in the tooling repository.')
parser.add_argument('-c', '--clone',
                    default='_none_',
                    help='Copy an existing cmd-*.sh. Needs --to, and --workspace to retarget it elsewhere.')
parser.add_argument('-t', '--to',
                    default='_none_',
                    help='With --clone, the new file name (cmd-<something>.sh).')
parser.add_argument('-n', '--new',
                    default='_none_',
                    help='Scaffold a new cmd-*.sh with the bootstrap chain already correct. Needs --workspace.')
parser.add_argument('-b', '--label',
                    default='_none_',
                    help="With --new, the '# workspace-name:' header — the human name the dashboard shows.")
parser.add_argument('-o', '--propose',
                    default='_none_',
                    help='Hand one cmd-*.sh to the AI agent to file the issue and open the PR on the tooling repository.')
parser.add_argument('-s', '--summary',
                    default='_none_',
                    help='With --propose, what the command is for. Goes into the issue and the PR.')
parser.add_argument('-y', '--confirm',
                    action='store_true',
                    default=False,
                    help='With --propose, actually create the issue and the PR. Without it, only the plan is printed.')
ARGEOF
