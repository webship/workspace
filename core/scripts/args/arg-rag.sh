#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('RAG_NAME',
                    nargs='?',
                    default="_all_",
                    help='Which index, as <workspace>/<project>, just <project>, or the raw collection name. Default: all of them.')
parser.add_argument('-a', '--rag-action',
                    default="list",
                    choices=['list', 'info', 'search', 'remove', 'servers', 'bind', 'mcp-register', 'mcp-unregister', 'serve', 'status'],
                    help='list the indexes, describe one, search one, drop one, list the RAG servers, bind a project to one, register the database with the Claude Code CLI over MCP, unregister it, serve it in the foreground, or show its status [default %(default)s].')
parser.add_argument('-q', '--query',
                    default="",
                    help='The question, for -a search. Example: -q "how is the hero section styled"')
parser.add_argument('-n', '--limit',
                    default="5",
                    help='How many passages to return [default %(default)s].')
parser.add_argument('-m', '--milvus-project',
                    default="_settings_",
                    help='Which RAG server (Milvus instance) to use, and what -a bind writes. Pass "default" to unbind [default: the project\'s binding in rag/bindings.yml, else milvus.project from the workspace settings].')
ARGEOF
