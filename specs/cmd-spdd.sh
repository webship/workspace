#!/usr/bin/env bash

# workspace-name: Spec (Structured-Prompt-Driven Development)

# Structured-Prompt-Driven Development for this workspace: a change is designed as an artifact
# — story, analysis, REASONS Canvas — that is reviewed, versioned and kept in sync with the code.
# See martinfowler.com/articles/structured-prompt-driven, and specs/AGENTS.md for how it is used
# here.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.specs.settings.yml);

ARGPARSE_DESCRIPTION="Design a change as a reviewed, versioned prompt: story, analysis, REASONS Canvas"
source ${WORKSPACE_SCRIPTS}/args/arg-spdd.sh || exit 1 ;

shift $#;

# `cmd-spdd.sh dev/myproject "add a thing"` starts a spec; everything else needs its verb named.
if [ "${SPDD_ACTION}" == '_auto_' ] ; then
  if [ ! "${TOPIC}" == '_none_' ] ; then SPDD_ACTION="story" ; else SPDD_ACTION="list" ; fi
fi

spdd_command ;
