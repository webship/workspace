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
                    choices=['list', 'add', 'remove'],
                    default='list',
                    help='list the characters (default), add one, or remove one (its file is moved aside, its model kept).')
parser.add_argument('-i', '--id',
                    type=text,
                    default="_none_",
                    help='The character id: lowercase letters, digits and hyphens, e.g. ada.')
parser.add_argument('-n', '--name',
                    type=text,
                    default="_none_",
                    help='The name it shows and answers to, e.g. Ada.')
parser.add_argument('-m', '--model',
                    type=text,
                    default="_none_",
                    help='Where its body comes from: an https URL to a .vrm, or osa:<name> from Open Source Avatars (bash cmd-tools-avatar-catalog.sh -a avatars --list). Downloaded into public/models/<id>.vrm.')
parser.add_argument('-M', '--model-file',
                    type=text,
                    default="_none_",
                    help='A model already in the project public/models/, e.g. my-character.vrm.')
parser.add_argument('-e', '--voice-engine',
                    choices=['browser', 'piper', 'elevenlabs'],
                    default='_settings_',
                    help='browser (free), piper (free, offline) or elevenlabs (spends credits). Default: avatar.voice_engine, piper.')
parser.add_argument('-v', '--voice',
                    type=text,
                    default="_settings_",
                    help='The voice: a Piper voice name (en_GB-alba-medium), an ElevenLabs voice id, or empty for the browser default. Default: avatar.voice, a free Piper voice.')
parser.add_argument('-L', '--language',
                    type=text,
                    default='en-US',
                    help='What it speaks by default, e.g. en-GB or ar-JO.')
parser.add_argument('-g', '--gender',
                    choices=['f', 'm'],
                    default="_none_",
                    help='Picks Arabic grammar for the page labels.')
parser.add_argument('-c', '--credit',
                    type=text,
                    default="_none_",
                    help='Who made the model and under which terms. Filled in from the registry for osa: models.')
parser.add_argument('-p', '--persona-file',
                    type=text,
                    default="_none_",
                    help='A text file with the persona: who the character is and how it speaks. Used when it has no agent.')
parser.add_argument('-G', '--agent',
                    type=text,
                    default="_none_",
                    help='A Claude Code agent in ~/.claude/agents/ to be its mind. Or create one: cmd-tools-avatar-agent.sh -a create.')
parser.add_argument('-R', '--replace',
                    action='store_true',
                    default=False,
                    help='Overwrite an existing characters/<id>.json.')
ARGEOF
