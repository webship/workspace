#!/usr/bin/env bash

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The project whose graph becomes a vault.')
parser.add_argument('-r', '--remove',
                    action='store_true',
                    default=False,
                    help='Delete the vault. The graph it was made from is left alone.')
parser.add_argument('-s', '--status',
                    action='store_true',
                    default=False,
                    help='Say what is there without building anything.')
parser.add_argument('-m', '--max-canvas-nodes',
                    default="300",
                    help='How many entities the canvas may draw, most-connected first [default %(default)s]. Every entity gets a note either way; this only bounds the canvas, which stops being readable long before it stops being drawable.')
EOF
