#!/usr/bin/env bash

# Arguments for cloning a project — folder and database — into a new name,
# here or in another workspace. Two shapes of clone, one command:
#
#   the default    a full independent copy (rsync + its own database)
#   --worktree     a git worktree of the same repository, sharing one .git
#
# --worktree is only offered where it can work: the source has to be a git
# checkout. Everything below it is worktree-only and says so, because a flag
# that silently does nothing is worse than one that refuses.
argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The project to clone (a folder in this workspace).')
parser.add_argument('-t', '--to',
                    default="_none_",
                    help='The name of the clone. Required. Example: --to myproject-copy')
parser.add_argument('-w', '--target-workspace',
                    default="_none_",
                    help='Clone into this workspace instead of the current one. Example: --target-workspace sandboxes')
parser.add_argument('-g', '--worktree',
                    action='store_true',
                    help='Clone as a git worktree instead of copying the files: one shared .git, a branch per folder, its own DDEV project. Needs the source to be a git checkout.')
parser.add_argument('-b', '--branch',
                    default="_none_",
                    help='Worktree only. The branch to check out; created from the current HEAD when it does not exist. Defaults to the clone name.')
parser.add_argument('--no-build-copy',
                    action='store_true',
                    help='Worktree only. Do not copy the git-ignored build (vendor, contrib, files, settings) from the source — leaves you to run composer install yourself.')
# --extra-hostname, not --hostname: argparse assigns the dest as a shell variable
# and HOSTNAME is a bash builtin. Clobbering it inside a build script is the kind
# of thing that is found much later, in something unrelated.
parser.add_argument('-H', '--extra-hostname',
                    default="_none_",
                    help='Give the clone an extra address as well as its canonical one. A label, no dots: --extra-hostname staging becomes staging.ddev.site.')
parser.add_argument('-W', '--with-workspace-hostname',
                    action='store_true',
                    help='Give the clone <name>-<workspace> as an extra address, so which workspace it lives in is visible in one flat hostname.')
parser.add_argument('--no-db',
                    action='store_true',
                    help='Do not export and import the database. The clone starts with whatever an empty DDEV project has.')
EOF
