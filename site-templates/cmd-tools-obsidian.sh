#!/usr/bin/env bash

# Turn a project's knowledge graph into an Obsidian vault — one note per entity,
# a [[wikilink]] per relation, and a JSON Canvas of the map. Written next to the
# graph in graphs/site-templates/<project>/obsidian/.
#
# Build the graph first with cmd-tools-graphify.sh: this reads what that wrote
# rather than parsing the project a second time.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.site-templates.settings.yml);

ARGPARSE_DESCRIPTION="Build an Obsidian vault from the knowledge graph of a project in the site-templates workspace"
source ${WORKSPACE_SCRIPTS}/args/arg-obsidian.sh || exit 1 ;

shift $#;

export MAX_CANVAS_NODES="${MAX_CANVAS_NODES}";

if [ "${REMOVE}" == 'yes' ] ; then
  obsidian_remove ;
elif [ "${STATUS}" == 'yes' ] ; then
  obsidian_status ;
else
  obsidian_project ;
fi
