#!/usr/bin/env bash

# Index a project in this workspace into the Milvus vector database
# (https://github.com/milvus-io/milvus) held in ~/workspace/rag, or ask an
# existing index a question.
#
# The RAG counterpart of cmd-tools-graphify.sh: graphify parses the CODE into a
# graph and reads no Markdown, Twig, *.module hooks or Drupal wiring YAML — this
# indexes the text of exactly those and retrieves passages from them.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.themes.settings.yml);

ARGPARSE_DESCRIPTION="Build or query the Milvus RAG index of a project in the themes workspace"
source ${WORKSPACE_SCRIPTS}/args/arg-ragify.sh || exit 1 ;

shift $#;

if [ -n "${QUERY}" ] ; then
  ragify_query_project ;
else
  ragify_project ;
fi
