#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('GRAPH_NAME',
                    nargs='?',
                    default="_all_",
                    help='Which graph, as <workspace>/<project> or just <project>. Default: all of them.')
parser.add_argument('-a', '--graphs-action',
                    default="list",
                    choices=['list', 'collect', 'remove', 'mcp-register', 'mcp-unregister', 'serve'],
                    help='list the graphs, collect strays left inside projects, remove one, register it with the Claude Code CLI over MCP, unregister it, or serve it in the foreground [default %(default)s].')
ARGEOF
