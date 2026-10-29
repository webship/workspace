#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='The name of the avatar project. It becomes https://<PROJECT_NAME>.ddev.site. Default: avatar.project from the workspace settings.')
parser.add_argument('-r', '--repo',
                    default="_settings_",
                    help='The avatar app repository to clone. Default: avatar.repo from the workspace settings.')
parser.add_argument('-b', '--branch',
                    default="_settings_",
                    help='The branch to clone. Default: avatar.branch.')
parser.add_argument('-A', '--link-agents',
                    action='store_true',
                    default=False,
                    help='Link the project Claude Code agents (claude/agents/*.md) into ~/.claude once it is up. They then point at THIS copy.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the avatar in a browser when it is ready.')
ARGEOF
