#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-l', '--list-remote',
                    action='store_true',
                    default=False,
                    help='List the specs the shared repository carries.')
parser.add_argument('-d', '--diff',
                    default='_none_',
                    nargs='?',
                    const='_all_',
                    help='Show what the shared copy would change, before taking it. A name filters.')
parser.add_argument('-p', '--pull',
                    default='_none_',
                    nargs='?',
                    const='_all_',
                    help='Take the shared copy. Yours is backed up first when it differs. A name filters.')
parser.add_argument('-s', '--share',
                    action='store_true',
                    default=False,
                    help='How to propose one of yours back to the shared repository. Creates nothing.')
ARGEOF
