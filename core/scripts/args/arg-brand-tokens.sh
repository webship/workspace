#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-c', '--cached',
                    action='store_true',
                    default=False,
                    help='Skip the Figma fetch and use the cached values (core/config/brand-tokens.json).')
parser.add_argument('-s', '--show',
                    action='store_true',
                    default=False,
                    help='Print the token values.')
parser.add_argument('-n', '--no-apply',
                    action='store_true',
                    default=False,
                    help='Refresh the cache only; do not rewrite the dashboard stylesheet.')
ARGEOF
