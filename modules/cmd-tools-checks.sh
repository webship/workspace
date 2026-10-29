#!/usr/bin/env bash

# Run the code-quality checks a package in this workspace already declares in its package.json —
# lint:js, lint:css, lint:yaml, spellcheck, phpcs, and the browser suite — mapped onto one set of
# canonical names so the command means the same thing in every workspace.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.modules.settings.yml);

ARGPARSE_DESCRIPTION="Run the code-quality checks a modules item already declares"
source ${WORKSPACE_SCRIPTS}/args/arg-checks.sh || exit 1 ;

shift $#;

checks_command ;
