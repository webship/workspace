#!/usr/bin/env bash

# Graphify (https://github.com/Graphify-Labs/graphify) parses a codebase with
# tree-sitter into a knowledge graph you query instead of grepping. Local and
# deterministic for code; no vector store.
#
# What it actually covers on a Drupal project (graphify 0.9.28):
#
#   Covered   PHP classes under src/ — methods, `use` imports, extends,
#             implements, trait use, and constructor-injected services (typed
#             and promoted parameters) — plus JS, and SQL when the sql extra is
#             installed (see GRAPHIFY_PACKAGE below).
#   NOT       Markdown, and every other document. graphify classifies .md as a
#             doc, not code, and docs are only read by the semantic pass — so
#             --code-only skips them and a plain run graphs none of a project's
#             .md files. `--deep` plus an LLM backend is the only way in, and
#             that sends file contents to the backend.
#   NOT       Hooks in *.module / *.theme / *.install / *.profile / *.engine:
#             those extensions are not in graphify's dispatch table, so the
#             files are skipped ("not classified").
#   NOT       Twig templates. The string "twig" does not appear in graphify.
#   NOT       The Drupal wiring YAML — *.info.yml, *.services.yml,
#             *.routing.yml, *.libraries.yml, *.component.yml, recipe.yml.
#             graphify treats YAML as a document, so --code-only drops it, and
#             the semantic pass links those nodes to each other rather than to
#             the PHP classes.
#   NOT       PHP 8 attributes (#[Block], #[FieldType], …), so plugin-id → class
#             never appears. Interfaces, traits and enums get no node of their
#             own. *.inc is mis-parsed as Pascal and yields nothing.
#
# So: good for "what does this service depend on", useless for "which route
# hits this controller". Say so rather than implying a full Drupal map.
#
# The graph lands in <project>/graphify-out/: graph.json (queried),
# GRAPH_REPORT.md and graph.html (both written by the clustering step).

# Pin: graphify's node-id scheme changed inside 0.9.x, and its CLI silently
# ignores unknown flags, so an unpinned upgrade degrades without erroring.
GRAPHIFY_VERSION="0.9.28";

# Third-party and generated trees. Without these, a built Drupal site graphs its vendored JS
# instead of its own code: measured 20,618 nodes of which 17,302 (84%) came from
# web/libraries/ace alone, in 139s. With them: 1,236 nodes in 11s, and the hubs are the
# project's own classes.
# Third-party trees only. Nothing of the project's own is excluded: a manifest is not
# noise, it is content — on a built Drupal site composer.json IS the architecture,
# since the site is defined by what it requires rather than by custom PHP. It does
# make the graph JSON-heavy (graphify emits a node per key, so composer.json alone is
# ~286 nodes), which shows up in god-nodes as `require` and `scripts`. That is a
# ranking artefact, not a reason to drop the data — read past it, or ask the graph a
# question rather than reading the hub list.
# Excludes in three layers, because "third-party" is not one thing on a Drupal site.
#
# ALWAYS: nothing here is code anyone reads — 84% of one unfiltered site graph was vendored JS.
# CORE:   web/core is ~21,000 PHP files. Useful to have, ruinous as a default.
# CONTRIB: the modules a Drupal site actually behaves like. Excluding these was wrong: on a built
#          site the interesting code IS contrib, a custom module's classes extend and inject
#          contrib ones, and a graph that stops at the custom boundary answers "no such service"
#          for half the questions asked of it.
GRAPHIFY_ALWAYS_EXCLUDES="vendor web/libraries web/sites/default/files docroot/libraries docroot/sites/default/files node_modules graphify-out";
GRAPHIFY_CORE_EXCLUDES="web/core docroot/core";
GRAPHIFY_CONTRIB_EXCLUDES="web/modules/contrib web/themes/contrib web/profiles/contrib docroot/modules/contrib docroot/themes/contrib docroot/profiles/contrib drush/contrib";

# The scope the graph was built at, resolved from --scope / --all.
#   custom  — custom code only (what this used to do)
#   contrib — custom + contrib modules, themes and profiles. THE DEFAULT.
#   all     — everything, core and vendor included
function graphify_scope_excludes() {
  local scope="$1";
  case "${scope}" in
    all)     printf '%s' "" ;;
    custom)  printf '%s %s %s' "${GRAPHIFY_ALWAYS_EXCLUDES}" "${GRAPHIFY_CORE_EXCLUDES}" "${GRAPHIFY_CONTRIB_EXCLUDES}" ;;
    *)       printf '%s %s' "${GRAPHIFY_ALWAYS_EXCLUDES}" "${GRAPHIFY_CORE_EXCLUDES}" ;;
  esac
}

# Where a project's graph lives: the graphs workspace, one directory per project —
# ~/workspace/graphs/<workspace>/<project>/.
#
# graphify only ever writes `<path>/graphify-out`, and that is the wrong place for it here: it is
# tens of MB, Leiden clustering is not bit-stable so every rebuild diffs in full, and half the
# projects worth mapping are git repositories we ship — `products/educare` must not gain a
# graphify-out/ because someone mapped it. So the build writes there and the result is MOVED into
# the store; the project is left exactly as it was found, and every read passes --graph.
function graphify_store_dir() {
  printf '%s/graphs/%s/%s' "${WORKSPACE_ROOT}" "${doc_name}" "${PROJECT_NAME}";
}

function graphify_move_to_store() {
  local project_path="$1" store="$2" built="${project_path}/graphify-out";

  [ -d "${built}" ] || { echo "graphify wrote no graphify-out — nothing to store."; return 1 ; }

  mkdir -p "$(dirname "${store}")" ;
  rm -rf "${store}" ;
  mv "${built}" "${store}" || return 1 ;
  # The YAML mirror is an input to the build, not a result: it does not belong in the store and it
  # certainly does not belong in the project afterwards.
  rm -rf "${project_path}/graphify-yaml" ;
  return 0 ;
}

# Keep a derived path out of git WITHOUT touching the project's own .gitignore.
function graphify_git_exclude() {
  local project_path="$1" pattern="$2" file="${project_path}/.git/info/exclude";
  [ -d "${project_path}/.git" ] || return 0 ;
  mkdir -p "${project_path}/.git/info" ;
  grep -qxF "${pattern}" "${file}" 2>/dev/null || printf '%s\n' "${pattern}" >> "${file}" ;
}

# YAML, mapped by mirroring it as JSON.
#
# graphify has no YAML parser in its dispatch table, so on a Drupal tree it sees NONE of what
# actually defines behaviour: recipe.yml, config/*.yml, *.info.yml, *.services.yml, *.routing.yml,
# *.permissions.yml, *.libraries.yml. On a recipe that is the whole project — `products/educare`
# is 0 PHP files and 699 YAML ones, so a code-only graph of it is empty and every question about
# it answers "nothing found", which reads as "no such thing" rather than "not mapped".
#
# It DOES parse JSON (composer.json alone contributes ~286 nodes), so each YAML file is mirrored
# as `<file>.json` under graphify-yaml/ and that tree is included in the extract. The name has no
# leading dot on purpose: graphify skips hidden directories, so a `.graphify-yaml/` mirror was
# written and then parsed by nothing — the educare recipe's graph came back as 80 nodes of
# composer.json while its 699 YAML files went unseen. The mirrors are
# derived, never edited: the directory is rewritten on every run and kept out of git through
# .git/info/exclude, which is local and leaves the project's own .gitignore alone.
# $2 is the scope's exclude list. graphify anchors --exclude at the SCAN ROOT, so
# `--exclude web/core` cannot match `graphify-yaml/web/core/...`: without pruning the same paths
# here, a contrib-scope run printed "Core, vendor and libraries are excluded" while mirroring 3,256
# core YAML files into the graph. Measured on dev/amd-educare-1-0-x-site-template-manager.
function graphify_yaml_sidecars() {
  # Three statements, not one: in a single `local a=$1 b=${a}/x`, bash evaluates the right-hand
  # sides before `a` is visible, so `out` became "/graphify-yaml" — an absolute path at the
  # FILESYSTEM ROOT. On the host that failed with PermissionError; inside the dashboard container,
  # which runs as root, it silently succeeded and mirrored the whole tree to /graphify-yaml, which
  # is why an earlier run reported "mirrored 699 YAML file(s)" and the graph gained nothing.
  local project_path="$1";
  local excludes="$2";
  local out="${project_path}/graphify-yaml";

  if ! python3 -c 'import yaml' 2>/dev/null ; then
    echo "python3 has no yaml module, so the YAML files cannot be mirrored — the graph will cover code only.";
    return 0 ;
  fi

  rm -rf "${out}" ;
  python3 - "${project_path}" "${out}" ${excludes} <<'PYEOF'
import json, os, sys, pathlib
import yaml

root = pathlib.Path(sys.argv[1])
out = pathlib.Path(sys.argv[2])
# The scope's own excludes, as paths relative to the project root, plus the ones that are never
# worth mirroring whatever the scope is.
EXCLUDE_PATHS = {e.strip('/') for e in sys.argv[3:] if e.strip('/')}
SKIP = {'vendor', 'node_modules', 'graphify-out', 'graphify-yaml', '.git', 'files'}
written = failed = 0
for dirpath, dirnames, filenames in os.walk(root):
    rel = pathlib.Path(dirpath).relative_to(root)
    dirnames[:] = [d for d in dirnames
                   if d not in SKIP
                   and str((rel / d)) not in EXCLUDE_PATHS]
    for name in filenames:
        if not name.endswith(('.yml', '.yaml')):
            continue
        src = pathlib.Path(dirpath) / name
        try:
            # A Drupal config file can carry PHP-ish tags and multiple documents; take what parses
            # and skip what does not, rather than failing the whole run for one file.
            docs = [d for d in yaml.safe_load_all(src.read_text(errors='replace')) if d is not None]
        except Exception:
            failed += 1
            continue
        data = docs[0] if len(docs) == 1 else docs
        target = out / src.relative_to(root).parent / (name + '.json')
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_text(json.dumps(data, indent=1, default=str))
            written += 1
        except Exception:
            failed += 1
print(f"  mirrored {written} YAML file(s) as JSON for the graph" + (f", {failed} skipped (unparseable)" if failed else ""))
PYEOF

  graphify_git_exclude "${project_path}" "/graphify-yaml" ;
}

# The PyPI package is `graphifyy` (double y); the command is `graphify`. The
# [sql] extra is not optional for us: without tree_sitter_sql graphify parses no
# .sql file at all and says so only in a warning —
#   "2 .sql file(s) contributed nothing to the graph because a dependency is
#    missing: tree_sitter_sql not installed"
# — so the graph silently loses a language the coverage note promises.
GRAPHIFY_PACKAGE="graphifyy[sql]==${GRAPHIFY_VERSION}";

# The MCP server is a separate dependency, and its absence is only visible at run time: the
# `graphify-mcp` entry point exists either way and dies with
#   ModuleNotFoundError: No module named 'mcp'
# which the Claude Code CLI reports as "Connection closed", not as a missing package. So it is
# installed alongside rather than left to be discovered.
# Pinned below 2: PyPI's current mcp is 2.0.0, graphify 0.9.28 does `from mcp.types import AnyUrl`,
# and 2.x moved it — so an unpinned install produces a graphify-mcp that dies at import and a CLI
# that reports only "Connection closed". graphifyy's own [mcp] extra is unpinned, so the bound has
# to come from here.
GRAPHIFY_MCP_EXTRA="mcp<2";

# Make sure the graphify CLI is on PATH; install it with uv or pipx if not.
function ensure_graphify() {
  if command -v graphify > /dev/null 2>&1 ; then
    return 0 ;
  fi

  echo "graphify is not installed — installing ${GRAPHIFY_PACKAGE}.";
  if command -v uv > /dev/null 2>&1 ; then
    uv tool install "${GRAPHIFY_PACKAGE}" --with "${GRAPHIFY_MCP_EXTRA}" ;
  elif command -v pipx > /dev/null 2>&1 ; then
    pipx install "${GRAPHIFY_PACKAGE}" ;
    pipx inject graphifyy "${GRAPHIFY_MCP_EXTRA}" ;
  else
    # No pip fallback: Debian and Ubuntu mark the system python externally managed (PEP 668), so
    # `pip install --user` is refused, and `python3 -m venv` needs a python3-venv package that is
    # not installed by default. uv needs neither and installs into the home directory.
    echo "Neither uv nor pipx is available — installing uv into ~/.local/bin." ;
    if ! curl -LsSf https://astral.sh/uv/install.sh | sh ; then
      echo "Could not install uv. Install it or pipx by hand, then run this again:" ;
      echo "  curl -LsSf https://astral.sh/uv/install.sh | sh" ;
      return 1 ;
    fi
    export PATH="${HOME}/.local/bin:${PATH}" ;
    uv tool install "${GRAPHIFY_PACKAGE}" --with "${GRAPHIFY_MCP_EXTRA}" ;
  fi

  # uv puts its tools in ~/.local/bin, which is not on PATH in a non-login shell — and the
  # dashboard runs these through one.
  case ":${PATH}:" in
    *":${HOME}/.local/bin:"*) ;;
    *) export PATH="${HOME}/.local/bin:${PATH}" ;;
  esac

  if ! command -v graphify > /dev/null 2>&1 ; then
    echo "graphify still is not on PATH — try: uv tool update-shell" ;
    return 1 ;
  fi
}

# Pick an LLM backend for the semantic pass (--deep). `graphify extract` exits 1
# when it has documents to read and no backend, so check before running rather
# than failing halfway.
function graphify_backend_args() {
  graphify_backend="";

  # An env var wins, so a one-off run can point somewhere else.
  if [ -n "${ANTHROPIC_API_KEY}" ] || [ -n "${OPENAI_API_KEY}" ] || [ -n "${GEMINI_API_KEY}" ] || [ -n "${DEEPSEEK_API_KEY}" ] ; then
    return 0 ;
  fi

  # The local Claude Code CLI first, when settings.yml says it is active: it carries its own
  # session, so there is no key to hold and nothing goes to a third-party API. This used to be
  # the last resort, which meant a stray key in settings.yml quietly took precedence over the
  # login this machine already has.
  if [ "${ai_providers_claude_code_cli_active}" == 'true' ] && command -v claude > /dev/null 2>&1 ; then
    graphify_backend="--backend claude-cli";
    graphify_backend_provider="claude-cli";
    return 0 ;
  fi

  # Otherwise use the key the workspace already holds. bootstrap.sh has flattened
  # settings.yml, so ai_providers.anthropic.api_key is $ai_providers_anthropic_api_key.
  # Placeholders are not keys — sk-change-this would fail deep in the run with an
  # authentication error rather than here with a sentence.
  local key;
  for provider in anthropic openai gemini ; do
    key=$(eval "echo \${ai_providers_${provider}_api_key}") ;
    case "${key}" in ''|CHANGE_ME|sk-change-this) continue ;; esac
    case "${provider}" in
      anthropic) export ANTHROPIC_API_KEY="${key}" ;;
      openai)    export OPENAI_API_KEY="${key}" ;;
      gemini)    export GEMINI_API_KEY="${key}" ;;
    esac
    graphify_backend_provider="${provider}";
    return 0 ;
  done

  # The CLI again, for when it is not marked active but nothing else is configured either:
  # a working backend beats refusing to run.
  if command -v claude > /dev/null 2>&1 ; then
    graphify_backend="--backend claude-cli";
    graphify_backend_provider="claude-cli";
    return 0 ;
  fi
  return 1 ;
}


# Build (or refresh) the knowledge graph of a project in this workspace.
# Tell Claude Code, in the project itself, that a graph exists and how to use it.
#
# A `claude` session started in a project reads that project's CLAUDE.md, so this is
# the one place a note reaches the CLI without anyone remembering to mention it. The
# block is bounded by markers and only ever rewritten between them, because a project
# may have its own CLAUDE.md that matters more than ours.
#
# It states the coverage honestly. A graph that is trusted for what it does not
# contain is worse than no graph: asking it "where is this route handled" returns
# nothing, and nothing is easily read as "there is no such route".
# A note in the project's own CLAUDE.md, so a session started there knows the graph exists and
# where it is. Written ONLY where it cannot dirty something we ship: a built site has no git, and
# on a git repository the note is written only if CLAUDE.md is absent or untracked — then the file
# is excluded locally, so it never becomes a commit. On a tracked CLAUDE.md the command prints the
# query line instead of editing the file.
function graphify_write_project_note() {
  local project_path="$1" store="$2";
  local file="${project_path}/CLAUDE.md";

  # The graph has already been moved out by the time this runs, so the counts come from the store.
  # Reading ${project_path}/graphify-out here is what made the note say "? nodes, ? edges".
  store="${store:-$(graphify_store_dir)}";

  if [ -d "${project_path}/.git" ] ; then
    if git -C "${project_path}" ls-files --error-unmatch CLAUDE.md > /dev/null 2>&1 ; then
      echo "  ${project_path}/CLAUDE.md is tracked, so it is left alone. Query the graph with:";
      echo "    bash cmd-tools-graphify.sh ${PROJECT_NAME} --query \"…\"";
      return 0 ;
    fi
    graphify_git_exclude "${project_path}" "/CLAUDE.md" ;
  fi
  local begin="<!-- graphify:begin -->";
  local end="<!-- graphify:end -->";
  local json="${store}/graph.json";
  local nodes="?" links="?";

  if [ -f "${json}" ] && command -v python3 > /dev/null 2>&1 ; then
    read -r nodes links <<< "$(python3 -c "
import json,sys
try:
    d=json.load(open('${json}'))
    print(len(d.get('nodes',[])), len(d.get('links',[])))
except Exception:
    print('?','?')
" 2>/dev/null)";
  fi

  local block;
  block=$(cat <<NOTE
${begin}
## Knowledge graph

This project has a graphify knowledge graph — ${nodes} nodes, ${links} edges — built by
\`cmd-tools-graphify.sh\` from the workspace folder. It lives OUTSIDE this project, in
\`${store}/\`, so nothing here is generated or gitignored. **Query it before grepping the tree**,
then open the files it points at:

\`\`\`bash
G=${store}/graph.json
graphify query "what does this service depend on?" --graph \$G   # BFS from the matching nodes
graphify explain "SomeClass" --graph \$G                          # a node and its neighbours
graphify path "ClassA" "ClassB" --graph \$G                        # how two things connect
graphify god-nodes --top 15 --graph \$G                           # the most connected nodes
\`\`\`

**Know what it does not contain, so a silent miss is not read as an answer.** It maps PHP classes
under \`src/\` (methods, \`use\`, extends, implements, traits, constructor-injected services), JS, and
SQL. It does **not** map hooks in \`.module\`/\`.theme\`/\`.install\`/\`.profile\`, any Twig, any
\`*.yml\` — so routing, services and plugin wiring are absent — Markdown, or PHP 8 attributes, which
is why plugin-id to class never appears. A question about routes or config will come back empty
whether or not the answer exists: fall back to reading the files.

### Updating it

The graph is a snapshot; it does not follow edits. After changing code:

\`\`\`bash
cd ~/workspace/<workspace> && bash cmd-tools-graphify.sh <project>   # re-extract and re-cluster
\`\`\`

\`graphify add <url>\` fetches a URL into \`./raw\` and folds it into the graph, for pulling an
upstream issue or doc in as context. The graph is kept in the graphs workspace rather than here
because it is tens of MB and Leiden clustering is not bit-stable, so it re-diffs entirely on every
rebuild.
${end}
NOTE
)

  if [ -f "${file}" ] && grep -q "${begin}" "${file}" ; then
    # The block goes through the environment, not stdin: the replacement text is
    # multi-line and contains the markers themselves, so quoting it into a command
    # line or a second heredoc is how this breaks.
    GRAPHIFY_NOTE="${block}" python3 - "${file}" "${begin}" "${end}" <<'PYEOF'
import os, re, sys
path, begin, end = sys.argv[1], sys.argv[2], sys.argv[3]
block = os.environ['GRAPHIFY_NOTE'].rstrip('\n')
text = open(path).read()
# re.sub would treat backslashes in the replacement as escapes; pass a function.
text = re.sub(re.escape(begin) + r'.*?' + re.escape(end), lambda _m: block, text, flags=re.S)
open(path, 'w').write(text)
PYEOF
    echo "  Refreshed the graph note in ${file}";
  else
    { [ -f "${file}" ] && printf '\n'; printf '%s\n' "${block}"; } >> "${file}" ;
    echo "  Added a graph note to ${file} — a claude session in this project will read it";
  fi
}

# Put something into the graph that is not in the tree.
#
# `graphify add <url>` fetches a page into the project's ./raw and folds it into
# graph.json, which makes the graph a place to KEEP things — an upstream issue, a
# spec, a changelog — so a later session can query them alongside the code instead of
# being handed the same context again.
function graphify_store_url() {
  local project_path="$1" url="$2" store;
  store="$(graphify_store_dir)";

  case "${url}" in
    http://*|https://*) ;;
    *) echo "--store needs an http(s) URL." ; return 1 ;;
  esac
  # The graph is in the store, not in the project: gating on ${project_path}/graphify-out made this
  # unreachable the moment the graph moved out.
  if [ ! -f "${store}/graph.json" ]; then
    echo "No graph yet — build one first: bash cmd-tools-graphify.sh <project>" ;
    return 1 ;
  fi

  # Folding a fetched document in is a semantic step, so it needs the same backend
  # --deep does; say so here rather than failing inside graphify.
  if ! graphify_backend_args ; then
    echo "Storing a URL reads the page, which needs an LLM backend: set" ;
    echo "ai_providers.<provider>.api_key in core/config/settings.yml, export" ;
    echo "ANTHROPIC_API_KEY, or install the claude CLI." ;
    return 1 ;
  fi

  echo "Fetching ${url} into ${project_path}/raw and adding it to the graph…" ;
  echo "  (its contents go to ${graphify_backend_provider})" ;
  # graphify writes to <path>/graphify-out and nowhere else, so the store is put back for the run
  # and moved out again afterwards — the same shape the build uses.
  cp -a "${store}" "${project_path}/graphify-out" || return 1 ;
  if ! ( cd "${project_path}" && graphify add "${url}" ${graphify_backend} ) ; then
    rm -rf "${project_path}/graphify-out" ;
    return 1 ;
  fi
  graphify_move_to_store "${project_path}" "${store}" || return 1 ;
  graphify_write_project_note "${project_path}" "${store}" ;
  echo "Stored. Ask about it with: bash cmd-tools-graphify.sh ${PROJECT_NAME} --query \"…\"" ;
}

function graphify_project() {
  ensure_graphify || return 1 ;

  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  local extract_args="";
  local cluster_args="--no-label";
  local exclude="";

  if [ ! -d "${project_path}" ]; then
    echo "No such project: ${project_path}";
    return 1 ;
  fi

  echo "*---------------------------------------------------------------------*";
  echo "  Graphify ${doc_name}/${PROJECT_NAME}";
  echo "*---------------------------------------------------------------------*";

  if [ "${DEEP}" == 'yes' ] ; then
    if graphify_backend_args ; then
      echo "" ;
      echo "  --deep: reading the docs, Markdown and other non-code files through" ;
      echo "  ${graphify_backend_provider}. Their CONTENTS are sent to that service — this is a" ;
      echo "  client project, so be sure that is acceptable before continuing." ;
      echo "" ;
    fi
    if ! graphify_backend_args ; then
      echo "--deep needs an LLM backend: set ANTHROPIC_API_KEY (or OPENAI_API_KEY," ;
      echo "GEMINI_API_KEY, DEEPSEEK_API_KEY), or install the claude CLI." ;
      return 1 ;
    fi
    extract_args="${graphify_backend}";
    cluster_args="${graphify_backend}";
    echo "Deep pass: AST + semantic extraction over docs, PDFs and images.";
    echo "That backend reads file contents. It does NOT connect Drupal YAML to";
    echo "PHP classes — it builds a parallel document graph. Code-only is the";
    echo "useful default.";
  else
    extract_args="--code-only";
    echo "Code-only pass: local AST extraction, no API key, nothing leaves the machine.";
  fi

  if [ "${FORCE}" == 'yes' ] ; then
    extract_args="${extract_args} --force";
  fi

  # graphify persists --exclude into the project's graphify-out, so later runs keep the scope.
  local scope="${SCOPE}";
  if [ "${ALL}" == 'yes' ] ; then
    scope="all";
  fi
  case "${scope}" in
    all)     echo "Scope: everything — core and vendor included. Slow, and the graph is dominated by third-party code." ;;
    custom)  echo "Scope: custom code only — contrib and core are excluded." ;;
    contrib) echo "Scope: custom + contrib (modules, themes, profiles). Core, vendor and libraries are excluded." ;;
    *)       echo "Unknown scope '${scope}' — use custom, contrib or all." ; return 1 ;;
  esac
  for exclude in $(graphify_scope_excludes "${scope}") ; do
    extract_args="${extract_args} --exclude ${exclude}";
  done
  # argparse.sh emits an nargs='+' option as a bash ARRAY, so plain ${EXCLUDE} is only its FIRST
  # element: `--exclude a b` used to drop b. [0] still reads the sentinel on a scalar default.
  if [ ! "${EXCLUDE[0]}" == '_none_' ] ; then
    for exclude in ${EXCLUDE[*]} ; do
      extract_args="${extract_args} --exclude ${exclude}";
    done
  fi

  # graphify keeps its AST cache and its persisted --exclude list inside graphify-out, so the
  # previous build is put back before extracting — otherwise every run is a full re-parse.
  local store;
  store="$(graphify_store_dir)";
  if [ -d "${store}" ] && [ ! -d "${project_path}/graphify-out" ] ; then
    cp -a "${store}" "${project_path}/graphify-out" ;
  fi

  if [ "${NO_YAML}" == 'yes' ] ; then
    rm -rf "${project_path}/graphify-yaml" ;
    extract_args="${extract_args} --exclude graphify-yaml";
    echo "Skipping the YAML mirror — on a recipe or a config-heavy module that leaves the graph empty.";
  else
    echo "Mirroring YAML as JSON so config, recipes, services and routing reach the graph…";
    graphify_yaml_sidecars "${project_path}" "$(graphify_scope_excludes "${scope}")" ;
  fi

  graphify extract "${project_path}" ${extract_args} || return 1 ;

  # `extract` writes graph.json only. Clustering is what produces the report
  # and the browsable graph, and it runs fine with no API key (--no-label keeps
  # deterministic community names and does not persist placeholders, so a later
  # --deep run can still name them). Never pass --no-viz: it deletes graph.html.
  echo "";
  echo "Clustering and writing the report…";
  graphify cluster-only "${project_path}" ${cluster_args} || return 1 ;

  # Out of the project, into the graphs workspace.
  graphify_move_to_store "${project_path}" "${store}" || return 1 ;

  # A note only where it cannot dirty a repository we ship.
  graphify_write_project_note "${project_path}" "${store}" ;

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Graph written to ${store}/";
  echo "    graph.html       — open it in a browser (needs internet: it loads";
  echo "                       vis-network from unpkg.com)";
  echo "    GRAPH_REPORT.md  — key concepts and suggested questions";
  echo "    graph.json       — queried by graphify query|path|explain";
  echo "";
  echo "  Covered: PHP classes under src/ (extends, implements, traits,";
  echo "  injected services), JS and SQL. NOT covered: hooks in";
  echo "  .module/.theme/.install, Twig, *.yml wiring, and Markdown (a";
  echo "  document — only --deep reads those) — see the notes in";
  echo "  core/scripts/functions/fun-graphify.sh.";
  echo "";
  echo "  Ask it something — the graph is outside the project, so pass --graph:";
  echo "    graphify query \"what does this service depend on?\" --graph ${store}/graph.json";
  echo "    graphify god-nodes --top 15 --graph ${store}/graph.json";
  echo "  or from the workspace folder, which fills that in for you:";
  echo "    bash cmd-tools-graphify.sh ${PROJECT_NAME} --query \"…\"";
  echo "*---------------------------------------------------------------------*";
}

# Ask the project's graph a question, without re-reading the codebase.
function graphify_query_project() {
  ensure_graphify || return 1 ;

  local store graph_file;
  store="$(graphify_store_dir)";
  graph_file="${store}/graph.json";

  if [ ! -f "${graph_file}" ]; then
    echo "No graph yet for ${doc_name}/${PROJECT_NAME} — build one first:";
    echo "  bash cmd-tools-graphify.sh ${PROJECT_NAME}";
    return 1 ;
  fi

  # graphify query exits 0 even when nothing matches, so read the output rather
  # than trusting the exit code. --graph because the graph lives in the graphs
  # workspace, not in the project.
  graphify query "${QUERY}" --graph "${graph_file}" ;
}
