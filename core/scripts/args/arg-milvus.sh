#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='Name of the Milvus instance, and so its hostname. Default: milvus.project from the workspace settings.')
parser.add_argument('-V', '--milvus-version',
                    default="_settings_",
                    help='Milvus image tag, e.g. v2.6.21 or v3.0.0 [default: milvus.version from the workspace settings].')
parser.add_argument('-A', '--attu-version',
                    default="_settings_",
                    help='Attu (web UI) image tag [default: milvus.attu_version from the workspace settings].')
parser.add_argument('-p', '--grpc-port',
                    default="_settings_",
                    help='Host port to publish Milvus gRPC/REST on. The first free port from here up is used, because pymilvus and the MCP server cannot go through the DDEV router [default: milvus.grpc_port].')
parser.add_argument('-u', '--public-uri',
                    default="_settings_",
                    help='Which hostname serves the Attu UI: hub (<project>.rag.workspace.ddev.site), canonical (<project>.ddev.site), or a URL used verbatim.')
parser.add_argument('-a', '--authorization',
                    action='store_true',
                    default=False,
                    help='Turn Milvus authentication on. Off by default: this is a local development database, and every client here would otherwise have to carry the credential.')
parser.add_argument('-f', '--force',
                    action='store_true',
                    default=False,
                    help='Rebuild an existing instance. This DELETES its volumes — every collection in it goes with them.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the Attu UI in a browser when the instance is up.')
ARGEOF
