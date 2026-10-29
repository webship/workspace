#!/usr/bin/env bash

# workspace-name: Hostnames (extra domains)
#
# What a project answers at, and how to give it another address.
#
# A DDEV project's URL comes from its NAME (`<name>.ddev.site`), and the dashboard
# hands out a second, hierarchical one (`<project>.dev.workspace.ddev.site`).
# This adds a THIRD shape: a flat hostname of your choosing, so the same project
# name in two workspaces can be told apart —
# `test3-dev.ddev.site` beside `test3-test.ddev.site`.
#
# It ADDS rather than renames. Renaming a DDEV project kills the old URL,
# recreates its containers and volumes, and leaves the project name no longer
# matching the folder — which is what makes a git worktree collide with its
# source. An extra hostname costs nothing and is reversible.
#
#   bash cmd-tools-hostnames.sh                                  # every project here
#   bash cmd-tools-hostnames.sh myproject                        # just this one
#   bash cmd-tools-hostnames.sh myproject --with-workspace --start
#   bash cmd-tools-hostnames.sh myproject --add staging --start
#   bash cmd-tools-hostnames.sh myproject --remove staging

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.dev.settings.yml);

ARGPARSE_DESCRIPTION="What a project answers at, and how to add another address"
source ${WORKSPACE_SCRIPTS}/args/arg-hostnames.sh || exit 1 ;

shift $#;

cd ${WORKSPACE_ROOT}/${doc_name};

hostnames_command ;
