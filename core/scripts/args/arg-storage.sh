#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-s', '--status',
                    action='store_true',
                    default=False,
                    help='Each workspace: local or on second storage, link health, drive mounted, free space. The default.')
parser.add_argument('-m', '--move',
                    default='',
                    metavar='WORKSPACE',
                    help='Copy a workspace to second storage, verify by checksum, swap it for a symlink. Keeps <name>.pre-move.')
parser.add_argument('-b', '--back',
                    default='',
                    metavar='WORKSPACE',
                    help='Bring a workspace back to a local folder, verified. Keeps the copy on the drive.')
parser.add_argument('-r', '--remove-pre-move',
                    default='',
                    metavar='WORKSPACE',
                    help='Delete <name>.pre-move, only once <name> is a working link to second storage.')
parser.add_argument('-l', '--relink',
                    action='store_true',
                    default=False,
                    help='Point workspace links at storage.second where the same folder is there (after the drive moved).')
parser.add_argument('-M', '--mounts',
                    action='store_true',
                    default=False,
                    help='Write the dashboard compose override that mounts the second storage (machine-only, generated).')
parser.add_argument('-n', '--dry-run',
                    action='store_true',
                    default=False,
                    help='Say what would happen and change nothing.')
parser.add_argument('-q', '--quiet',
                    action='store_true',
                    default=False,
                    help='Only speak when something changed or is wrong.')
ARGEOF
