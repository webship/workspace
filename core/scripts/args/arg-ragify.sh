#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project to index.')
parser.add_argument('-q', '--query',
                    default="",
                    help='Ask the existing index a question instead of rebuilding it. Example: --query "where is the newsletter form defined"')
parser.add_argument('-n', '--limit',
                    default="5",
                    help='How many passages a --query returns [default %(default)s].')
parser.add_argument('-m', '--milvus-instance',
                    default="_settings_",
                    help='Which RAG server (Milvus instance in ~/workspace/rag) holds this project\'s index, remembered in rag/bindings.yml for every later run. Pass "default" to unbind. Build another server with rag/cmd-milvus-project.sh <name> [default: the project\'s binding, else the shared default].')
parser.add_argument('-e', '--embedding',
                    default="_settings_",
                    choices=['bm25', 'openai', '_settings_'],
                    help='bm25 builds the sparse vectors inside Milvus — no model, no key, nothing leaves this machine. openai additionally sends every chunk to the OpenAI API for a dense vector and searches both [default: rag.embedding from the rag workspace settings].')
parser.add_argument('-S', '--scope',
                    default="contrib",
                    choices=['custom', 'contrib', 'all'],
                    help='How much of the tree to index: custom code only, custom + contrib modules/themes/profiles, or everything including core and vendor [default %(default)s].')
parser.add_argument('-a', '--all',
                    action='store_true',
                    default=False,
                    help='Same as --scope all: do not skip vendor/, core/, contrib or libraries. Slow, and the index ends up dominated by third-party text.')
parser.add_argument('-A', '--append',
                    action='store_true',
                    default=False,
                    help='Add to the existing collection instead of rebuilding it. Without this a re-index replaces the collection, which is what keeps a deleted file from staying findable.')
parser.add_argument('-x', '--exclude',
                    default="_none_",
                    nargs='+',
                    help='Extra paths to skip, on top of the defaults. Example: --exclude "web/modules/custom/legacy tests"')
ARGEOF
