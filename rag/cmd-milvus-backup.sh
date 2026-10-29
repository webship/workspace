#!/usr/bin/env bash

# workspace-name: Milvus (backup)

# Archive a Milvus instance: the etcd metadata, the MinIO segments and the data directory, plus a
# JSON manifest of its collections. All three volumes together — a dump of any one of them
# restores nothing.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.rag.settings.yml);

ARGPARSE_DESCRIPTION="Back up a Milvus instance — its metadata, its segments and its collection manifest"
source ${WORKSPACE_SCRIPTS}/args/arg-milvus-backup.sh || exit 1 ;

shift $#;

milvus_backup ;
