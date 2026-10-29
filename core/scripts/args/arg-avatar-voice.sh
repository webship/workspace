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
                    help='The avatar project, e.g. my-avatar. Not needed for piper-list and piper-install.')
parser.add_argument('-a', '--action',
                    choices=['status', 'piper-list', 'piper-install', 'elevenlabs-link', 'elevenlabs-unlink'],
                    default='status',
                    help='status of every engine (default); list or install free Piper voices; link or unlink the ElevenLabs key from settings.yml (never printed).')
parser.add_argument('-v', '--voice',
                    type=text,
                    default="_none_",
                    help='For piper-install: a Piper voice name, e.g. en_GB-alba-medium or ar_JO-kareem-medium.')
ARGEOF
