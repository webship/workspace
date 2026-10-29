#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-a', '--apply',
                    action='store_true',
                    default=False,
                    help='Actually remove things. WITHOUT this flag the command only reports what it would remove, which is the default on purpose: everything here is a deletion.')
parser.add_argument('-o', '--only',
                    default="_none_",
                    help='Reclaim only these categories, comma separated: cache, volumes, images, containers. Default is all four. Example: --only cache,containers')
parser.add_argument('-k', '--keep-days',
                    default="7",
                    help='Never touch anything created or last used within this many days, whatever else the rules say [default %(default)s]. A project you removed an hour ago may still be one you want back.')
parser.add_argument('-l', '--list-protected',
                    action='store_true',
                    default=False,
                    help='Print every project name the sweep is protecting and why, then stop. Use this when a removal looks wrong: if a name is on that list, nothing belonging to it can be touched.')
ARGEOF
