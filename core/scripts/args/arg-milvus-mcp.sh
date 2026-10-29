#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='Which Milvus instance. Default: milvus.project from the workspace settings.')
parser.add_argument('-a', '--mcp-action',
                    default="status",
                    choices=['status', 'register', 'unregister', 'serve'],
                    help='status shows the instance and whether the CLI knows it; register adds the Milvus MCP server to the Claude Code CLI (stdio, all collections); unregister removes it; serve runs it in the foreground for debugging [default %(default)s].')
ARGEOF
