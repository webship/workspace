#!/usr/bin/env bash

# Index a project in this workspace into the Milvus vector database — the RAG counterpart of
# cmd-tools-graphify.sh.
#
# The two answer different questions, and the difference is the reason both exist:
#
#   graphify   parses code with tree-sitter into a graph. "What injects this service", "what
#              extends this class". It reads no Markdown, no Twig, no *.module hooks and none of
#              the Drupal wiring YAML — those are documents to it, and a code-only run drops them.
#   ragify     indexes the TEXT of the same tree — including exactly those files — and retrieves
#              passages. "Where is this explained", "which template renders that", "what does the
#              recipe set for this field".
#
# Nothing here calls an LLM. Retrieval is Milvus's built-in BM25 function: the database tokenises
# the text and builds the sparse vectors itself, so the default run sends nothing anywhere.
# `--embedding openai` is the one mode that does, and it says so.

# The chunks land in a collection named for the project, in whichever Milvus instance the rag
# workspace holds. Deterministic (see rag_collection_name), so a re-index overwrites its own
# collection and never anyone else's.

# Third-party and generated trees, reusing exactly what graphify already excludes — a built site
# build is 90% vendored code, and indexing it buries the project's own text under Symfony's.
# The scope flag means the same thing here as there:
#   custom   the project's own code only
#   contrib  custom + contrib modules, themes and profiles   THE DEFAULT
#   all      everything, core and vendor included
function ragify_scope_excludes() {
  graphify_scope_excludes "$1" ;
}

# Build (or rebuild) the index of a project in this workspace.
function ragify_project() {
  local project_path milvus_project uri token collection excludes embedding key model started;

  project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}.";
    return 1 ;
  fi

  # The database lives in the rag workspace, so its settings are read from there rather than from
  # the calling workspace's own file — a module being indexed has no `milvus:` block of its own.
  eval $(parse_yaml "${WORKSPACE_CONFIG}/workspace.rag.settings.yml" "rag_ws_");
  milvus_project="$(milvus_setting "${rag_ws_milvus_project}")"; milvus_project="${milvus_project:-milvus}";
  # rag_collection_name() reads the unprefixed name, so the naming rule is the same one
  # cmd-tools-rag.sh applies when it reads the collection back.
  rag_collection_prefix="${rag_ws_rag_collection_prefix}";

  # Which RAG server. One shared instance is the default; --milvus binds this project to another
  # one and remembers it, so every later index, search and MCP registration for it goes there.
  if [ "${MILVUS_INSTANCE}" != '_settings_' ] ; then
    if [ "${MILVUS_INSTANCE}" == 'default' ] ; then
      rag_binding_set "${doc_name}" "${PROJECT_NAME}" "" ;
      echo "Unbound ${doc_name}/${PROJECT_NAME} — it uses the default server again.";
    elif printf '%s\n' "$(rag_instances)" | grep -qx "${MILVUS_INSTANCE}" ; then
      rag_binding_set "${doc_name}" "${PROJECT_NAME}" "${MILVUS_INSTANCE}" ;
      echo "Bound ${doc_name}/${PROJECT_NAME} to the ${MILVUS_INSTANCE} server.";
    else
      echo "No RAG server called '${MILVUS_INSTANCE}' in ${WORKSPACE_ROOT}/rag.";
      echo "  Build it first: cd ${WORKSPACE_ROOT}/rag && bash cmd-milvus-project.sh ${MILVUS_INSTANCE}";
      return 1 ;
    fi
  fi
  milvus_project="$(rag_resolve_instance "${doc_name}" "${PROJECT_NAME}" '_settings_')";

  # milvus_uri()/milvus_host_port() resolve against the rag workspace folder, which is not the
  # folder this command was run from.
  local doc_name_saved="${doc_name}";
  doc_name="rag";
  uri="$(milvus_uri "${milvus_project}")";
  token="$(milvus_token)";
  if ! milvus_require_running "${milvus_project}" ; then
    doc_name="${doc_name_saved}";
    return 1 ;
  fi
  doc_name="${doc_name_saved}";

  collection="$(rag_collection_name "${doc_name}" "${PROJECT_NAME}")";
  excludes="$(ragify_scope_excludes "${SCOPE}")";
  [ "${ALL}" == 'yes' ] && excludes="";
  # argparse.sh emits an nargs='+' option as a bash ARRAY, so plain ${EXCLUDE} is its FIRST
  # element and `--exclude a b` quietly indexed b. [0] reads the sentinel on a scalar default too.
  if [ "${EXCLUDE[0]}" != '_none_' ] ; then
    excludes="${excludes} ${EXCLUDE[*]}";
  fi

  embedding="${EMBEDDING}";
  if [ "${embedding}" == '_settings_' ] ; then
    embedding="$(milvus_setting "${rag_ws_rag_embedding}")"; embedding="${embedding:-bm25}";
  fi
  model="$(milvus_setting "${rag_ws_rag_openai_model}")"; model="${model:-text-embedding-3-small}";

  key="";
  if [ "${embedding}" == 'openai' ] ; then
    # The key the workspace already holds. A placeholder is not a key — sk-change-this would fail
    # deep in the run with an authentication error rather than here with a sentence.
    key="${OPENAI_API_KEY:-${ai_providers_openai_api_key}}";
    case "${key}" in ''|CHANGE_ME|sk-change-this)
      echo "--embedding openai needs an OpenAI key: set ai_providers.openai.api_key in";
      echo "core/config/settings.yml, or export OPENAI_API_KEY for a one-off run.";
      return 1 ;;
    esac
    echo "";
    echo "Dense embeddings are ON: every indexed chunk of ${PROJECT_NAME} is sent to the OpenAI API";
    echo "(${model}). The default BM25 mode sends nothing anywhere.";
  fi

  echo "";
  echo "Indexing ${doc_name}/${PROJECT_NAME} into ${collection}";
  echo "  Milvus     ${uri}";
  echo "  Scope      ${SCOPE}$([ "${ALL}" == 'yes' ] && echo ' (--all: nothing excluded)')";
  echo "  Retrieval  ${embedding}";
  echo "";

  started="$(date +%s)";
  # shellcheck disable=SC2086
  rag_python --uri "${uri}" --token "${token}" index \
    --collection "${collection}" \
    --path "${project_path}" \
    --chunk-lines "$(milvus_setting "${rag_ws_rag_chunk_lines}")" \
    --chunk-overlap "$(milvus_setting "${rag_ws_rag_chunk_overlap}")" \
    --max-file-kb "$(milvus_setting "${rag_ws_rag_max_file_kb}")" \
    --embedding "${embedding}" \
    --openai-model "${model}" \
    ${key:+--openai-key "${key}"} \
    ${APPEND:+--append} \
    --progress \
    ${excludes:+--exclude ${excludes}} || return 1 ;

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Indexed in $(( $(date +%s) - started ))s.";
  echo "";
  echo "  Ask it something:";
  echo "    cd ${WORKSPACE_ROOT}/rag && bash cmd-tools-rag.sh ${doc_name}/${PROJECT_NAME} -a search -q \"...\"";
  echo "  Give the whole database to the Claude Code CLI (all collections, one registration):";
  echo "    cd ${WORKSPACE_ROOT}/rag && bash cmd-milvus-mcp.sh -a register";
  echo "*---------------------------------------------------------------------*";
}

# Ask an existing index a question, from the project's own workspace folder — the same search
# cmd-tools-rag.sh runs, without changing directory.
function ragify_query_project() {
  local milvus_project uri token collection doc_name_saved;

  eval $(parse_yaml "${WORKSPACE_CONFIG}/workspace.rag.settings.yml" "rag_ws_");
  rag_collection_prefix="${rag_ws_rag_collection_prefix}";
  milvus_project="$(rag_resolve_instance "${doc_name}" "${PROJECT_NAME}" '_settings_')";

  doc_name_saved="${doc_name}";
  doc_name="rag";
  uri="$(milvus_uri "${milvus_project}")";
  token="$(milvus_token)";
  if ! milvus_require_running "${milvus_project}" ; then
    doc_name="${doc_name_saved}";
    return 1 ;
  fi
  doc_name="${doc_name_saved}";

  collection="$(rag_collection_name "${doc_name}" "${PROJECT_NAME}")";
  rag_python --uri "${uri}" --token "${token}" search \
    --collection "${collection}" --query "${QUERY}" --limit "${LIMIT}" ;
}
