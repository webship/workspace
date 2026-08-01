#!/usr/bin/env bash

# The graphs workspace: every project's knowledge graph, one directory per project at
# graphs/<workspace>/<project>/. cmd-tools-graphify.sh builds them and moves them here;
# this command is what you do with them afterwards.
#
# The graph is NOT kept inside the project on purpose — it is tens of MB, Leiden clustering is not
# bit-stable so it re-diffs entirely on every rebuild, and half the projects worth mapping are
# repositories we ship.

# Resolve a name to one or more <workspace>/<project> directories INSIDE the store.
#
# Every path this returns is checked, because the caller deletes what it is handed: a name is
# refused if it contains `..`, if it does not resolve to exactly two segments under the store, or if
# the directory holds no graph.json. Without that, `-a remove '../modules/toc_api'` resolved to a
# real project checkout and deleted it — verified, then fixed.
function graphs_resolve() {
  local wanted="$1" base dir real;
  base="$(cd "${WORKSPACE_ROOT}/graphs" 2>/dev/null && pwd -P)" || return 0 ;

  # A candidate is emitted only if it survives containment, shape and content checks.
  _graphs_emit() {
    local candidate="$1" resolved;
    resolved="$(realpath -m "${candidate}" 2>/dev/null)" || return 0 ;
    case "${resolved}" in
      "${base}/"*) ;;
      *) return 0 ;;
    esac
    # Exactly <workspace>/<project> under the store, and it must actually hold a graph.
    [ "$(printf '%s' "${resolved#${base}/}" | tr -cd '/' | wc -c)" -eq 1 ] || return 0 ;
    [ -f "${resolved}/graph.json" ] || return 0 ;
    printf '%s\n' "${resolved}";
  }

  case "${wanted}" in
    *..*) return 0 ;;
  esac

  if [ "${wanted}" == '_all_' ] ; then
    while read -r dir ; do
      [ -n "${dir}" ] && _graphs_emit "${dir}" ;
    done <<< "$(find "${base}" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | sort)"
    return 0 ;
  fi

  case "${wanted}" in
    */*) _graphs_emit "${base}/${wanted}" ;;
    *)   # A bare project name can match in two workspaces; the caller decides what to do with that.
         while read -r dir ; do
           [ -n "${dir}" ] && _graphs_emit "${dir}" ;
         done <<< "$(find "${base}" -mindepth 2 -maxdepth 2 -type d -name "${wanted}" 2>/dev/null | sort)" ;;
  esac
}

function graphs_list() {
  local base="${WORKSPACE_ROOT}/graphs" dir ws project nodes links size;

  if [ -z "$(graphs_resolve "${GRAPH_NAME}")" ] ; then
    echo "No graphs yet. Build one from the project's workspace folder:";
    echo "  cd ${WORKSPACE_ROOT}/<workspace> && bash cmd-tools-graphify.sh <project>";
    return 0 ;
  fi

  printf '%-46s %8s %8s %9s  %s\n' "GRAPH" "NODES" "EDGES" "SIZE" "PROJECT";
  while read -r dir ; do
    [ -n "${dir}" ] || continue ;
    ws="$(basename "$(dirname "${dir}")")";
    project="$(basename "${dir}")";
    read -r nodes links <<< "$(python3 -c "
import json
try:
    d = json.load(open('${dir}/graph.json'))
    print(len(d.get('nodes', [])), len(d.get('links', d.get('edges', []))))
except Exception:
    print('?', '?')
" 2>/dev/null)";
    size="$(du -sh "${dir}" 2>/dev/null | cut -f1)";
    printf '%-46s %8s %8s %9s  %s\n' "${ws}/${project}" "${nodes}" "${links}" "${size}" \
      "$([ -d "${WORKSPACE_ROOT}/${ws}/${project}" ] && echo present || echo "gone — safe to remove")";
  done <<< "$(graphs_resolve "${GRAPH_NAME}")"
}

# Sweep up graphs left inside projects by an older build, or by graphify run by hand.
function graphs_collect() {
  local out ws project dest moved=0;

  while read -r out ; do
    [ -n "${out}" ] || continue ;
    ws="$(basename "$(dirname "$(dirname "${out}")")")";
    project="$(basename "$(dirname "${out}")")";
    dest="${WORKSPACE_ROOT}/graphs/${ws}/${project}";
    if [ -d "${dest}" ] ; then
      echo "  ${ws}/${project}: already in the graphs workspace — left where it is, delete the copy in the project yourself if it is stale.";
      continue ;
    fi
    mkdir -p "$(dirname "${dest}")" ;
    if mv "${out}" "${dest}" ; then
      echo "  moved ${ws}/${project}";
      moved=$((moved + 1));
      # That project's CLAUDE.md still tells a session the graph is in graphify-out/ and gives
      # commands with no --graph, which now error. Rewrite the note against the new location.
      PROJECT_NAME="${project}" doc_name="${ws}" \
        graphify_write_project_note "$(dirname "${out}")" "${dest}" > /dev/null 2>&1 ;
    fi
  done <<< "$(find "${WORKSPACE_ROOT}" -mindepth 3 -maxdepth 3 -name graphify-out -type d 2>/dev/null | sort)"

  # The YAML mirror is a build input, never a result.
  find "${WORKSPACE_ROOT}" -mindepth 3 -maxdepth 3 -name graphify-yaml -type d -exec rm -rf {} + 2>/dev/null ;

  echo "";
  echo "Collected ${moved} graph(s) into ${WORKSPACE_ROOT}/graphs/.";
}

function graphs_remove() {
  local matches count dir;

  # Deleting everything must be asked for by name, never be the default. GRAPH_NAME defaults to
  # _all_, so without this a bare `-a remove` deleted whichever graph sorted first.
  if [ "${GRAPH_NAME}" == '_all_' ] ; then
    echo "Name the graph to remove: bash cmd-tools-graphs.sh <workspace>/<project> -a remove";
    echo "  (--graphs-action list shows them)";
    return 1 ;
  fi

  matches="$(graphs_resolve "${GRAPH_NAME}")";
  count="$(printf '%s' "${matches}" | grep -c . )";

  if [ "${count}" -eq 0 ] ; then
    echo "No graph matches '${GRAPH_NAME}' inside ${WORKSPACE_ROOT}/graphs.";
    echo "  Run with --graphs-action list to see them.";
    return 1 ;
  fi
  # Ambiguity is refused rather than resolved by sort order: the same project name can exist in two
  # workspaces, and this is the one action that cannot be undone.
  if [ "${count}" -gt 1 ] ; then
    echo "'${GRAPH_NAME}' matches ${count} graphs — name the workspace too:";
    while read -r dir ; do printf '  %s\n' "${dir#${WORKSPACE_ROOT}/graphs/}"; done <<< "${matches}"
    return 1 ;
  fi

  dir="${matches}";
  rm -rf "${dir}" ;
  echo "Deleted ${dir#${WORKSPACE_ROOT}/graphs/}. Rebuild it with cmd-tools-graphify.sh in its workspace folder.";
}

# Serve one graph to the Claude Code CLI over MCP.
#
# graphify ships its own MCP server (`graphify-mcp`, i.e. python -m graphify.serve) with ten tools:
# query_graph, get_node, get_neighbors, shortest_path, get_community, god_nodes, graph_stats,
# list_prs, get_pr_impact, triage_prs. Registered on **stdio**, so there is no port to keep open
# and no daemon to remember: the CLI starts it when a session needs it and stops it after.
function graphs_mcp() {
  local dir ws project name graph;
  dir="$(graphs_resolve "${GRAPH_NAME}" | head -1)";

  if [ "${GRAPH_NAME}" == '_all_' ] ; then
    echo "Name the graph: bash cmd-tools-graphs.sh <workspace>/<project> --graphs-action ${GRAPHS_ACTION}";
    return 1 ;
  fi
  if [ -z "${dir}" ] || [ ! -f "${dir}/graph.json" ] ; then
    echo "No graph for '${GRAPH_NAME}'. Build it first from its workspace folder.";
    return 1 ;
  fi

  ws="$(basename "$(dirname "${dir}")")";
  project="$(basename "${dir}")";
  name="graph-${ws}-${project}";
  graph="${dir}/graph.json";

  case "${GRAPHS_ACTION}" in
    mcp-register)
      # `command -v` is not enough: the entry point is installed whether or not the mcp dependency
      # is, and without it the server dies at import time — which the CLI reports only as
      # "Connection closed". Prove the import instead.
      if ! graphify-mcp --help > /dev/null 2>&1 ; then
        echo "graphify-mcp cannot run — its mcp dependency is missing or too new (graphify needs mcp<2).";
        echo "  Fix it with: uv tool install --force \"graphifyy[sql]==${GRAPHIFY_VERSION:-0.9.28}\" --with \"mcp<2\"";
        return 1 ;
      fi
      claude mcp add --scope user "${name}" -- graphify-mcp "${graph}" || return 1 ;
      echo "";
      echo "Registered ${name} with the Claude Code CLI (stdio, no port).";
      echo "  Open a NEW session to see its tools: query_graph, get_node, get_neighbors,";
      echo "  shortest_path, get_community, god_nodes, graph_stats, list_prs, get_pr_impact, triage_prs.";
      echo "  Rebuilding the graph needs no re-registration — the file path does not change.";
      ;;
    mcp-unregister)
      claude mcp remove --scope user "${name}" && echo "Removed ${name} from the Claude Code CLI." ;
      ;;
    serve)
      echo "Serving ${ws}/${project} over MCP on stdio — Ctrl+C to stop.";
      exec graphify-mcp "${graph}" ;
      ;;
  esac
}

function graphs_command() {
  case "${GRAPHS_ACTION}" in
    list)    graphs_list ;;
    collect) graphs_collect ;;
    remove)  graphs_remove ;;
    mcp-register|mcp-unregister|serve) graphs_mcp ;;
    *)       echo "Unknown action '${GRAPHS_ACTION}'." ; return 1 ;;
  esac
}
