#!/usr/bin/env bash

# workspace-name: Milvus (vector database for RAG)

# Run Milvus self-hosted inside DDEV, in the rag workspace.
# One command for the whole standalone stack: the DDEV project, the Milvus + etcd + MinIO compose
# services, the Attu web UI, and the nginx reverse proxy that puts all of it on one https origin.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings — every default this command uses lives in the milvus: block there.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.rag.settings.yml);

ARGPARSE_DESCRIPTION="Run Milvus self-hosted in DDEV, with the Attu UI and a published gRPC port for pymilvus and MCP"
source ${WORKSPACE_SCRIPTS}/args/arg-milvus.sh || exit 1 ;

shift $#;

build_milvus ;
