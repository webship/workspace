#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project to map.')
parser.add_argument('-q', '--query',
                    default="",
                    help='Ask the existing graph a question instead of rebuilding it. Example: --query "what does this controller depend on?"')
parser.add_argument('-d', '--deep',
                    action='store_true',
                    default=False,
                    help='Add the semantic pass over docs, PDFs and images. Needs an LLM backend and sends file contents to it. It does not link Drupal YAML to PHP classes.')
parser.add_argument('-f', '--force',
                    action='store_true',
                    default=False,
                    help='Skip the incremental manifest gate and the semantic cache. Unchanged files are still replayed from graphify-out/cache/ast — delete that directory for a true re-parse.')
parser.add_argument('-S', '--scope',
                    default="contrib",
                    choices=['custom', 'contrib', 'all'],
                    help='How much of the tree to map: custom code only, custom + contrib modules/themes/profiles, or everything including core and vendor [default %(default)s].')
parser.add_argument('-a', '--all',
                    action='store_true',
                    default=False,
                    help='Same as --scope all: do not skip vendor/, core/, contrib or libraries. Slow, and the graph ends up dominated by third-party code.')
parser.add_argument('-Y', '--no-yaml',
                    action='store_true',
                    default=False,
                    help='Do not mirror the YAML as JSON. graphify parses no YAML of its own, so on a recipe or a config-heavy module this leaves the graph empty.')
parser.add_argument('-s', '--store',
                    default='_none_',
                    help='Fetch a URL into the project\'s ./raw and fold it into the graph, so the AI can read it later. Example: --store https://www.drupal.org/node/3586390')
parser.add_argument('-x', '--exclude',
                    default="_none_",
                    nargs='+',
                    help='Extra paths to skip, on top of the defaults. Example: --exclude "web/modules/custom/legacy tests"')
ARGEOF
