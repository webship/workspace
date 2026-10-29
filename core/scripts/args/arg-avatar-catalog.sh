#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-a', '--action',
                    choices=['voices', 'avatars'],
                    default='voices',
                    help='voices: voice engines and their licences (default); avatars: avatar libraries and their licences.')
parser.add_argument('-l', '--list',
                    action='store_true',
                    default=False,
                    help='With avatars: also list every public VRM in the Open Source Avatars registry, with its licence.')
ARGEOF
