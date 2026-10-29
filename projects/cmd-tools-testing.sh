#!/usr/bin/env bash

# Set up the automated-testing environment on an existing project in this workspace, or run its
# suite. Both happen inside DDEV.
#
# Unlike test/cmd-automated-testing-*-project.sh, this never builds a site from nothing and never
# deletes anything: it applies the testing stack to a project that is already here.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.projects.settings.yml);

ARGPARSE_DESCRIPTION="Configure the automated-testing environment of a projects project, or run its suite"
source ${WORKSPACE_SCRIPTS}/args/arg-testing.sh || exit 1 ;

shift $#;

testing_command ;
