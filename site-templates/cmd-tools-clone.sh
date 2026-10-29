#!/usr/bin/env bash

# Clone a project — folder and database — into a new name, in this workspace or
# another one. The clone becomes an independent DDEV project with its own name,
# containers and database; the source is never modified.
#
#   bash cmd-tools-clone.sh <project> --to <name>
#   bash cmd-tools-clone.sh <project> --to <name> --target-workspace sandboxes
#
# When the project is a git checkout it can be cloned as a git WORKTREE instead:
# one shared .git and one history, a branch per folder, and still its own DDEV
# project at its own URL with its own database.
#
#   bash cmd-tools-clone.sh <project> --to <name> --worktree
#   bash cmd-tools-clone.sh <project> --to <name> --worktree --branch 3512345-the-fix

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

ARGPARSE_DESCRIPTION="Clone a project (folder + database) into a new name, here or in another workspace"
source ${WORKSPACE_SCRIPTS}/args/arg-clone.sh || exit 1 ;

shift $#;

clone_project ;
