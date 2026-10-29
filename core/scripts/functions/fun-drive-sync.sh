#!/usr/bin/env bash

# Push a workspace folder to Google Drive. The work is in core/workspace-app/cli.js, which reads
# plugin.google-drive-sync.settings.yml, the plugin's own settings file; the dashboard's Sync button runs this same command.

DRIVE_MCP_NAME="google-drive-workspace" ;

function drive_node() {
  command -v node > /dev/null 2>&1 || { echo "node is not installed here. Run this from the dashboard, or install node." >&2 ; return 1 ; }
  WORKSPACE_ROOT="${WORKSPACE_ROOT}" WORKSPACE_CONFIG="${WORKSPACE_CONFIG}" node "${WORKSPACE_ROOT}/core/workspace-app/plugins/google-drive-sync/lib/$1" "${@:2}" ;
}

function drive_sync_usage() {
  cat <<'USAGE'
usage: cmd-tools-google-drive-sync.sh [ITEM] [options]

  (no ITEM)            push the files selected by this folder's targets (the plugin settings); nothing else
  ITEM                 push one named item whatever the targets, into a Drive folder of its own name
  --folder ID|LINK     push there instead of this folder's destination (or <storage folder>/<this folder>)
  --dry-run            list what would be uploaded; nothing is written
  --overwrite          approve it: without this, nothing is written when the push would overwrite a file or
                       write into a sub folder that is already on Drive (it lists them and exits 3)
  -a status            whether Drive is configured and connected, and the folder chosen for each workspace
  -a register          add the Google Drive MCP server to the Claude Code CLI (stdio)
  -a unregister        remove it
  -a serve             run the MCP server in the foreground, for debugging

New and changed files are uploaded, in chunks, so large videos are fine. Nothing on Drive is ever
deleted, and nothing already there is replaced until you approve it with --overwrite. Never pushed:
hidden files, cmd-*.sh, the workspace's own AGENTS.md/CLAUDE.md/README.md, anything that looks like it holds
a password or key, the `exclude` patterns of the plugin settings, and symbolic links.

Setup, once per person: paste the OAuth client id and secret into the dashboard's Sync panel (or
plugin.google-drive-sync.settings.yml), press Connect, and choose a storage folder, which can be a folder in a
Google Workspace shared drive. Every workspace then stores into <storage folder>/<workspace>.
Exit codes: 0 ok, 1 a file failed, 3 waiting for --overwrite.
USAGE
}

function drive_mcp_register() {
  local server="${WORKSPACE_ROOT}/core/workspace-app/plugins/google-drive-sync/lib/mcp.js" ;
  command -v claude > /dev/null 2>&1 || { echo "The claude CLI is not installed here." >&2 ; return 1 ; }
  # Prove the server starts and answers before registering it: a failure here is a sentence, and the
  # same failure afterwards is only "Connection closed" in some later session. It exits on EOF.
  if ! printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n' | WORKSPACE_ROOT="${WORKSPACE_ROOT}" WORKSPACE_CONFIG="${WORKSPACE_CONFIG}" timeout 15 node "${server}" 2> /dev/null | grep -q serverInfo ; then
    echo "The Google Drive MCP server will not start. Run it by hand to see why: node ${server}" >&2 ;
    return 1 ;
  fi
  claude mcp add --scope user --env "WORKSPACE_ROOT=${WORKSPACE_ROOT}" --env "WORKSPACE_CONFIG=${WORKSPACE_CONFIG}" "${DRIVE_MCP_NAME}" -- node "${server}" || return 1 ;
  echo "" ;
  echo "Registered ${DRIVE_MCP_NAME} with the Claude Code CLI (stdio, no port, no secret in the registration)." ;
  echo "  Open a NEW session for its tools: drive_status, drive_list_folders, drive_create_folder," ;
  echo "  drive_upload_file, drive_sync_workspace. It reads the same plugin settings as the dashboard." ;
}

function drive_sync_main() {
  local workspace="$1" action='sync' folder='' item='' dry=() over=() ; shift ;
  while [ $# -gt 0 ] ; do
    case "$1" in
      -h|--help) drive_sync_usage ; return 0 ;;
      -a|--drive-action) action="${2:-}" ; shift 2 || { drive_sync_usage >&2 ; return 2 ; } ;;
      --folder) folder="${2:-}" ; shift 2 || { drive_sync_usage >&2 ; return 2 ; } ;;
      --dry-run) dry=(--dry-run) ; shift ;;
      --overwrite) over=(--overwrite) ; shift ;;
      -*) echo "Unknown option: $1" >&2 ; drive_sync_usage >&2 ; return 2 ;;
      *) item="$1" ; shift ;;
    esac
  done
  case "${action}" in
    sync)
      local args=(sync "${workspace}") ;
      [ -n "${folder}" ] && args+=(--folder "${folder}") ;
      [ -n "${item}" ] && [ "${item}" != "_all_" ] && args+=(--item "${item}") ;
      drive_node cli.js "${args[@]}" "${dry[@]}" "${over[@]}" ;
      ;;
    status) drive_node cli.js status ;;
    register) drive_mcp_register ;;
    unregister) claude mcp remove --scope user "${DRIVE_MCP_NAME}" && echo "Removed ${DRIVE_MCP_NAME} from the Claude Code CLI." ;;
    serve) echo "Serving Google Drive over MCP on stdio — Ctrl+C to stop." >&2 ; drive_node mcp.js ;;
    *) echo "Unknown action: ${action}" >&2 ; drive_sync_usage >&2 ; return 2 ;;
  esac
}
