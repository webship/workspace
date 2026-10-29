#!/usr/bin/env bash

# The rag workspace: the Milvus vector database that holds every project's RAG index, and the
# commands that read it.
#
# The split mirrors graphs/: cmd-tools-ragify.sh (in each project's own workspace folder) BUILDS
# an index, and this command is what you do with it afterwards — list, inspect, search, drop, and
# hand it to the Claude Code CLI over MCP.
#
# Unlike a graph, an index is not a file: it is rows inside Milvus. So there is nothing to move
# out of the project and nothing to keep in the folder — `rag/` holds the database instance
# itself, and the collections live in it.

# pymilvus 2.6.x is the client for a Milvus 2.6.x server. Pinned below 3: pymilvus 3.x tracks the
# Milvus 3.0 line released on 2026-07-29, and pairing a 3.x client with the 2.6 server this
# workspace installs by default is exactly the combination that fails at connect time rather than
# at install time.
RAG_PYMILVUS="pymilvus>=2.6,<3";
RAG_OPENAI="openai>=1.40";

# Run the Python worker (core/scripts/libs/rag_index.py).
#
# Through `uv run --with`, not an installed tool: the dependency set is resolved and cached by uv,
# so there is no venv of ours to create, no PATH entry to add and nothing to keep in sync with the
# rest of the workspace. The OpenAI client is only pulled in when a run actually asks for dense
# embeddings.
function rag_python() {
  local extra="";
  case " $* " in
    *" --embedding openai "*|*" --openai-key "*) extra="--with ${RAG_OPENAI}" ;;
  esac
  # shellcheck disable=SC2086
  uv run --quiet --with "${RAG_PYMILVUS}" ${extra} \
    python3 "${WORKSPACE_SCRIPTS}/libs/rag_index.py" "$@" ;
}

# Which Milvus instance a project's index lives in.
#
# One shared instance is the default, and that is right for almost everything: a collection is
# already an isolation boundary, and a second Milvus is another etcd, another MinIO and another
# ~2 GB of containers. A project can still be BOUND to its own — a client engagement whose vectors
# must be backed up and handed over on their own, or one that needs a different Milvus version.
#
# The binding lives here, not in the project, for the same reason a graph does not: half the
# projects worth indexing are repositories we ship, and a repo must not gain a file because
# somebody indexed it. One line per bound project; anything unbound simply is not in the file.
RAG_BINDINGS_FILE="${WORKSPACE_ROOT}/rag/bindings.yml";

function rag_binding_get() {
  local workspace="$1" project="$2";
  [ -f "${RAG_BINDINGS_FILE}" ] || return 0 ;
  sed -n "s|^${workspace}/${project}:[[:space:]]*\([A-Za-z0-9_-]\+\)[[:space:]]*$|\1|p" "${RAG_BINDINGS_FILE}" | head -1 ;
}

function rag_binding_set() {
  local workspace="$1" project="$2" instance="$3" tmp;
  mkdir -p "$(dirname "${RAG_BINDINGS_FILE}")" ;
  if [ ! -f "${RAG_BINDINGS_FILE}" ] ; then
    cat > "${RAG_BINDINGS_FILE}" <<'HEADEREOF'
# Which Milvus instance holds each project's RAG index.
#
# Written by cmd-tools-ragify.sh --milvus <instance> and by the dashboard's RAG menu. A project
# that is not listed here uses milvus.project from core/config/workspace.rag.settings.yml.
#
# Machine-local state, like the graphs store: it describes what is built on THIS machine.
HEADEREOF
  fi
  tmp="$(mktemp)";
  grep -v "^${workspace}/${project}:" "${RAG_BINDINGS_FILE}" > "${tmp}" 2>/dev/null ;
  if [ -n "${instance}" ] ; then
    printf '%s/%s: %s\n' "${workspace}" "${project}" "${instance}" >> "${tmp}" ;
  fi
  mv "${tmp}" "${RAG_BINDINGS_FILE}" ;
}

# The instance a command should talk to: an explicit argument, then the binding, then the default.
function rag_resolve_instance() {
  local workspace="$1" project="$2" given="$3" bound;
  if [ -n "${given}" ] && [ "${given}" != '_settings_' ] ; then
    printf '%s' "${given}" ; return 0 ;
  fi
  bound="$(rag_binding_get "${workspace}" "${project}")";
  if [ -n "${bound}" ] ; then printf '%s' "${bound}" ; return 0 ; fi
  printf '%s' "$(milvus_resolve_project '_settings_')";
}

# Every Milvus instance built in the rag workspace: a directory with the compose file this
# tooling writes. Used by `-a servers` and by the dashboard's server picker.
function rag_instances() {
  local dir;
  for dir in "${WORKSPACE_ROOT}"/rag/*/ ; do
    [ -f "${dir}.ddev/docker-compose.milvus.yaml" ] || continue ;
    basename "${dir}" ;
  done
}

# The collection name for one project: <prefix>_<workspace>_<project>, with everything Milvus
# does not allow in an identifier folded to an underscore. Deterministic, so ragify writes and
# this command reads the same name without keeping state anywhere.
function rag_collection_name() {
  local workspace="$1" project="$2" prefix;
  prefix="$(milvus_setting "${rag_collection_prefix}")"; prefix="${prefix:-ws}";
  printf '%s_%s_%s' "${prefix}" "${workspace}" "${project}" | tr -c 'A-Za-z0-9_\n' '_' ;
}

# Resolve what the user named to a collection that exists.
#
# Accepts <workspace>/<project>, a bare <project> (matched across workspaces), or the raw
# collection name. Ambiguity is reported rather than resolved by sort order: drop is one of the
# actions here and it does not ask twice.
function rag_resolve_collection() {
  local wanted="$1" uri="$2" token="$3" all matches;
  all="$(rag_python --uri "${uri}" --token "${token}" --json collections 2>/dev/null \
        | python3 -c "import json,sys
try:
    print('\n'.join(row['collection'] for row in json.load(sys.stdin)))
except Exception:
    pass")";
  [ -n "${all}" ] || return 0 ;

  case "${wanted}" in
    */*) matches="$(printf '%s\n' "${all}" | grep -x "$(rag_collection_name "${wanted%%/*}" "${wanted##*/}")")" ;;
    *)   matches="$(printf '%s\n' "${all}" | grep -x "${wanted}")";
         [ -n "${matches}" ] || matches="$(printf '%s\n' "${all}" | grep -E "_${wanted}$")" ;;
  esac
  printf '%s' "${matches}";
}

# One resolved collection, or a sentence saying why not. Sets RAG_COLLECTION.
function rag_require_collection() {
  local uri="$1" token="$2" count;
  if [ "${RAG_NAME}" == '_all_' ] ; then
    echo "Name the index: bash cmd-tools-rag.sh <workspace>/<project> -a ${RAG_ACTION}";
    echo "  (-a list shows them)";
    return 1 ;
  fi
  RAG_COLLECTION="$(rag_resolve_collection "${RAG_NAME}" "${uri}" "${token}")";
  count="$(printf '%s' "${RAG_COLLECTION}" | grep -c . )";
  if [ "${count}" -eq 0 ] ; then
    echo "No index matches '${RAG_NAME}'.";
    echo "  Build it:  cd ${WORKSPACE_ROOT}/<workspace> && bash cmd-tools-ragify.sh ${RAG_NAME##*/}";
    return 1 ;
  fi
  if [ "${count}" -gt 1 ] ; then
    echo "'${RAG_NAME}' matches ${count} indexes — name the workspace too:";
    printf '  %s\n' ${RAG_COLLECTION};
    return 1 ;
  fi
  return 0 ;
}

function rag_command() {
  local project uri token target_ws target_project;

  # An index named as <workspace>/<project> resolves to the instance THAT project is bound to,
  # which is the whole point of binding: `-a search demos/educare` must reach the server holding
  # educare's vectors, not the default one.
  case "${RAG_NAME}" in
    */*) target_ws="${RAG_NAME%%/*}"; target_project="${RAG_NAME##*/}" ;;
    *)   target_ws=""; target_project="" ;;
  esac
  if [ -n "${target_ws}" ] ; then
    project="$(rag_resolve_instance "${target_ws}" "${target_project}" "${MILVUS_PROJECT}")";
  else
    project="$(milvus_resolve_project "${MILVUS_PROJECT}")";
  fi
  uri="$(milvus_uri "${project}")";
  token="$(milvus_token)";

  case "${RAG_ACTION}" in
    list|serve|mcp-register|mcp-unregister|status|servers|bind) : ;;
    *) milvus_require_running "${project}" || return 1 ;;
  esac

  case "${RAG_ACTION}" in
    servers)
      local instance bound_count;
      printf '%-28s %-10s %-28s %s\n' "SERVER" "STATE" "URI" "BOUND PROJECTS";
      while read -r instance ; do
        [ -n "${instance}" ] || continue ;
        # `grep -c` already prints 0 when it matches nothing — and exits 1 while doing so, so a
        # `|| echo 0` fallback appended a SECOND line and the count became "0\n0", which printf
        # then spread across two rows. The missing-file case is what the default is for.
        bound_count="$(grep -c ": ${instance}$" "${RAG_BINDINGS_FILE}" 2>/dev/null)";
        bound_count="${bound_count:-0}";
        printf '%-28s %-10s %-28s %s\n' "${instance}" \
          "$(docker ps --format '{{.Names}}' | grep -qx "ddev-${instance}-milvus-standalone" && echo running || echo stopped)" \
          "$(milvus_uri "${instance}")" \
          "${bound_count}$([ "${instance}" == "$(milvus_resolve_project '_settings_')" ] && echo ' (default)')";
      done <<< "$(rag_instances)"
      echo "";
      echo "Build another:  bash cmd-milvus-project.sh <name>";
      echo "Bind a project: bash cmd-tools-rag.sh <workspace>/<project> -a bind -m <name>";
      ;;
    bind)
      if [ -z "${target_ws}" ] ; then
        echo "Name the project as <workspace>/<project>: bash cmd-tools-rag.sh demos/educare -a bind -m <server>";
        return 1 ;
      fi
      if [ "${MILVUS_PROJECT}" == '_settings_' ] ; then
        echo "Name the server with -m: bash cmd-tools-rag.sh ${RAG_NAME} -a bind -m <server>";
        echo "  (-a servers lists them; -m default unbinds and falls back to the default server)";
        return 1 ;
      fi
      if [ "${MILVUS_PROJECT}" == 'default' ] ; then
        rag_binding_set "${target_ws}" "${target_project}" "" ;
        echo "${RAG_NAME} now uses the default server ($(milvus_resolve_project '_settings_')).";
        return 0 ;
      fi
      if ! printf '%s\n' "$(rag_instances)" | grep -qx "${MILVUS_PROJECT}" ; then
        echo "No Milvus instance called '${MILVUS_PROJECT}' in ${WORKSPACE_ROOT}/rag.";
        echo "  Build it first: cd ${WORKSPACE_ROOT}/rag && bash cmd-milvus-project.sh ${MILVUS_PROJECT}";
        return 1 ;
      fi
      rag_binding_set "${target_ws}" "${target_project}" "${MILVUS_PROJECT}" ;
      echo "${RAG_NAME} is now indexed into ${MILVUS_PROJECT} ($(milvus_uri "${MILVUS_PROJECT}")).";
      echo "  Re-index it there: cd ${WORKSPACE_ROOT}/${target_ws} && bash cmd-tools-ragify.sh ${target_project}";
      echo "  The old collection stays where it was — drop it with -a remove before rebinding if it is stale.";
      ;;
    list)
      milvus_require_running "${project}" || return 1 ;
      echo "Milvus ${project} on ${uri}";
      echo "";
      rag_python --uri "${uri}" --token "${token}" collections ;
      ;;
    info)
      rag_require_collection "${uri}" "${token}" || return 1 ;
      rag_python --uri "${uri}" --token "${token}" info --collection "${RAG_COLLECTION}" ;
      ;;
    search)
      if [ -z "${QUERY}" ] ; then
        echo "Give a question: bash cmd-tools-rag.sh <workspace>/<project> -a search -q \"how is the hero styled\"";
        return 1 ;
      fi
      rag_require_collection "${uri}" "${token}" || return 1 ;
      rag_python --uri "${uri}" --token "${token}" search \
        --collection "${RAG_COLLECTION}" --query "${QUERY}" --limit "${LIMIT}" ;
      ;;
    remove)
      rag_require_collection "${uri}" "${token}" || return 1 ;
      rag_python --uri "${uri}" --token "${token}" drop --collection "${RAG_COLLECTION}" ;
      ;;
    mcp-register|mcp-unregister|serve|status)
      # The MCP server is per INSTANCE, not per collection: its tools list and search every
      # collection in the database, so registering one index would be registering all of them.
      PROJECT_NAME="${project}";
      MCP_ACTION="${RAG_ACTION#mcp-}";
      milvus_mcp ;
      ;;
    *)
      echo "Unknown action '${RAG_ACTION}'." ; return 1 ;;
  esac
}
