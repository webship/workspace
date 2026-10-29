#!/usr/bin/env bash

# Refresh the Vardot brand tokens from the VDT Stylesheet in Figma and write
# them into the dashboard stylesheet. Fetches live when a Figma token is
# configured; otherwise uses the last values that were fetched, so the run
# always ends with a styled dashboard.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;


ARGPARSE_DESCRIPTION="Sync the Vardot brand tokens from Figma (falls back to the cached values)"
source ${WORKSPACE_SCRIPTS}/args/arg-brand-tokens.sh || exit 1 ;

shift $#;

brand_tokens_sync ;
