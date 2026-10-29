#!/usr/bin/env bash

# workspace-name: Penpot (self-hosted design platform)

# Run Penpot self-hosted inside DDEV, in the designs workspace.
# One command for what products/ai_penpot/docs/penpot-on-ddev.md documents by hand:
# the DDEV project, the Penpot compose stack, and the nginx reverse proxy.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.designs.settings.yml);

ARGPARSE_DESCRIPTION="Run Penpot self-hosted in DDEV, with plugins and access tokens enabled for AI work"
source ${WORKSPACE_SCRIPTS}/args/arg-penpot.sh || exit 1 ;

shift $#;

build_penpot ;
