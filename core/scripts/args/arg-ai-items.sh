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
                    help='List what the shared repo (webship/ai-agents) has.')
parser.add_argument('-o', '--source',
                    default='repo',
                    help='Where to read from: repo (webship/ai-agents) or claude (~/.claude). default [ repo ]')
parser.add_argument('-t', '--filter',
                    default='webship',
                    help='With --source claude, only items whose name starts with this. _all_ for every item. default [ webship ]')
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
parser.add_argument('--sources',
                    action='store_true',
                    default=False,
                    help='List the repositories this folder takes items from: each source, its state, its items and theirs.')
parser.add_argument('--source-add',
                    default='_none_',
                    help='Add a source and place its items in this folder: owner/repo, owner/repo@ref, an https:// address of a GitHub, GitLab or Bitbucket repository (a tree address picks a branch and a folder), or skills.sh/owner/repo/skill. NAME takes one item. Files only: shown, never run.')
parser.add_argument('--as',
                    dest='source_id',
                    default='_none_',
                    help='With --source-add, the id the source is listed under. Default: from the repository name.')
parser.add_argument('--ref',
                    default='_none_',
                    help='With --source-add, the branch or tag to read. Default: the repository default.')
parser.add_argument('--path',
                    dest='source_path',
                    default='_none_',
                    help='With --source-add, the folder of the repository to read.')
parser.add_argument('--source-check',
                    action='store_true',
                    default=False,
                    help='Ask upstream where each source is (NAME = one source id), without changing an item.')
parser.add_argument('--source-update',
                    action='store_true',
                    default=False,
                    help='Take what moved upstream, per source (NAME = one source id). An item changed here is left unless --force.')
parser.add_argument('--source-remove',
                    default='_none_',
                    help='Forget a source, by id, and remove the items it placed (one changed here is kept).')
parser.add_argument('--keep-items',
                    action='store_true',
                    default=False,
                    help='With --source-remove, keep every item the source placed.')
parser.add_argument('--force',
                    action='store_true',
                    default=False,
                    help='With --source-update or --source-remove, also replace or remove an item changed here. With --uninstall, also remove a file no install put there.')
parser.add_argument('--clis',
                    action='store_true',
                    default=False,
                    help='List the AI CLIs of the settings: on or off, the default, installed or missing, signed in or out.')
parser.add_argument('--items',
                    action='store_true',
                    default=False,
                    help='List this folder items against every AI CLI that is on: installed, differs, not installed.')
parser.add_argument('--cli',
                    default='_none_',
                    help='With --install or --uninstall, the AI CLI: an id of --clis (claude, gemini, codex, ...), or all for every CLI that is on. Without it --install is Claude Code, as before.')
parser.add_argument('--uninstall',
                    action='store_true',
                    default=False,
                    help='Take NAME out of the AI CLI named by --cli.')
ARGEOF

# Sources and AI CLIs: several repositories into this folder, and this folder into any AI CLI.
# These go to the one engine the dashboard uses too (core/workspace-app/ai-anycli.js), so a state
# cannot differ between the two. Everything else carries on to the command that sourced this file.
ai_items_any_cli "${doc_name}" ;
