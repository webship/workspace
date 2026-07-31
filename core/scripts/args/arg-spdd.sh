#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('SPEC_NAME',
                    nargs='?',
                    default="_all_",
                    help='A spec (its number, its slug, or <workspace>/<project>/NNN-slug) — or, when starting one, the TARGET as <workspace>/<project>.')
parser.add_argument('TOPIC',
                    nargs='?',
                    default="_none_",
                    help='What the change is, in a sentence. Given together with a target, this starts a new spec.')
parser.add_argument('-a', '--spdd-action',
                    default="_auto_",
                    choices=['_auto_', 'list', 'story', 'analysis', 'canvas', 'drift', 'sync', 'show'],
                    help='list the specs, start one (story), draft the analysis, draft the REASONS Canvas, check whether the canvas still matches the tree (drift), record that it does again (sync), or show a spec\'s files. Default: list, or story when a target and a topic are given.')
ARGEOF
