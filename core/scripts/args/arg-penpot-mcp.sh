#!/usr/bin/env bash

# One option, not five aliases: argparse-bash emits a shell assignment per DEFINED argument, so
# several `store_const` flags sharing a dest overwrite each other on the way out and `--start`
# silently parsed as `status`.
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='The Penpot instance the MCP server serves. Default: penpot.project from the workspace settings.')
parser.add_argument('-a', '--mcp-action',
                    default="status",
                    choices=['start', 'stop', 'status', 'register'],
                    help='start the server container, stop it, report its state, or register it with the Claude Code CLI [default %(default)s].')
ARGEOF
