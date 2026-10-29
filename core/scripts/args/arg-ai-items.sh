#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('NAME',
                    default='_all_',
                    nargs='?',
                    help='One item by name. Default: every item.')
parser.add_argument('-s', '--status',
                    action='store_true',
                    default=False,
                    help='Show what each source has: this workspace folder, ~/.claude, and the shared repo.')
parser.add_argument('-l', '--list-remote',
                    action='store_true',
                    default=False,
                    help='List what the shared repo (Vardot/dev-ai-agents) has.')
parser.add_argument('-o', '--source',
                    default='repo',
                    help='Where to read from: repo (Vardot/dev-ai-agents) or claude (~/.claude). default [ repo ]')
parser.add_argument('-t', '--filter',
                    default='vardot',
                    help='With --source claude, only items whose name starts with this. _all_ for every item. default [ vardot ]')
parser.add_argument('-f', '--fetch',
                    action='store_true',
                    default=False,
                    help='Fetch from the shared repo into ~/.claude, so a session can use it now.')
parser.add_argument('-p', '--pull',
                    action='store_true',
                    default=False,
                    help='Pull into this workspace folder from --source (repo by default, or claude).')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Install from this workspace folder into ~/.claude (your own draft).')
parser.add_argument('-k', '--check',
                    action='store_true',
                    default=False,
                    help='Compare what is installed against its source (repo or workspace draft), without changing anything.')
parser.add_argument('-A', '--add',
                    default='_none_',
                    help='Install NAME (or every item) from any GitHub repo: owner/repo, owner/repo@ref, or a github.com URL (tree URLs pick a branch and folder). Combines with --to.')
parser.add_argument('-U', '--update',
                    action='store_true',
                    default=False,
                    help='Re-install every tracked item whose source moved (repo or workspace draft). Combines with --to.')
parser.add_argument('-T', '--to',
                    default='_none_',
                    help='With --install, put it in one project instead of the global ~/.claude/: dev/myproject. Default: global.')
parser.add_argument('-P', '--propose',
                    action='store_true',
                    default=False,
                    help='Hand NAME to the AI agent to file the issue and open the PR on the shared repo. Prints the plan unless --confirm is added.')
parser.add_argument('-m', '--summary',
                    default='_none_',
                    help='With --propose, what the item is for. Goes into the issue and the PR.')
parser.add_argument('-C', '--confirm',
                    action='store_true',
                    default=False,
                    help='With --propose, actually create the issue and the PR. Without it, only the plan is printed.')
parser.add_argument('-c', '--clone-to',
                    default='_none_',
                    help='Copy NAME to this new name in this workspace folder, rewriting its identity, to customise it.')
parser.add_argument('-u', '--purpose',
                    default='_none_',
                    help='With --clone-to, what the copy is for. Claude Code then tailors and reformats it for that purpose.')
ARGEOF
