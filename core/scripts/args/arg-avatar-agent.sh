#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
import re

def text(value):
    # argparse-bash hands values to the shell through eval: refuse what the shell would expand.
    if re.search(r'[\$\`"\\\\]', value):
        raise argparse.ArgumentTypeError('may not contain quotes, dollar signs, backticks or backslashes')
    return value

parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_none_",
                    help='The avatar project, e.g. my-avatar.')
parser.add_argument('-a', '--action',
                    choices=['list', 'link', 'create', 'check'],
                    default='list',
                    help='list the project agents and whether ~/.claude uses them (default); link them into ~/.claude; create an agent for a character; check Claude Code in the container.')
parser.add_argument('-i', '--id',
                    type=text,
                    default="_none_",
                    help='For create: the character the agent is the mind of (characters/<id>.json).')
parser.add_argument('-R', '--replace',
                    action='store_true',
                    default=False,
                    help='For create: write the agent file again even if it exists. For link: point links that use another project copy at this one.')
ARGEOF
