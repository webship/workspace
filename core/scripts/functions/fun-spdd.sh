#!/usr/bin/env bash

# Structured-Prompt-Driven Development (martinfowler.com/articles/structured-prompt-driven) for
# this workspace: the prompt for a change is an artifact that is written, reviewed, versioned and
# kept in sync with the code — not something typed into a chat and lost.
#
# One spec is a directory:
#
#   specs/<workspace>/<project>/NNN-topic/
#     01-story.md      the ask: problem, definition of done, acceptance criteria
#     02-analysis.md   what already exists, what it touches, what could go wrong
#     03-canvas.md     the REASONS Canvas — the contract the change is generated from
#     04-tests.md      what proves it works
#     spec.yml         stage, links, and the commit the canvas was last true for
#
# The stages are gates, not decoration: analysis needs a story, a canvas needs an analysis. Each
# one is a file a person reads and edits before the next one is asked for — which is the whole
# method. The AI writes drafts; the gate is a human deciding the draft is right.
#
# THE RULE, from the article and enforced by `-a drift`: when reality diverges, fix the prompt
# first, then the code. A canvas that no longer describes the tree is worse than no canvas — it is
# a document people trust.
#
# What makes this workspace a good host for the method: SPDD's weakest step is analysis ("scan the
# codebase"). Here a project may already have a graphify knowledge graph (structure) and a Milvus
# RAG index (its prose, templates and configuration), and `spdd_context` feeds both into the
# analysis rather than asking a model to guess.

SPDD_STAGES="story analysis canvas tests done";

# Where the specs live. Outside every project, like the graphs store, and for the same reason:
# a repository we ship must not gain a spec directory because somebody planned a change to it.
function spdd_root() {
  printf '%s/specs' "${WORKSPACE_ROOT}";
}

# specs/<workspace>/<project> — the target a spec is about. A spec for the tooling itself uses the
# `workspace` pseudo-project, which is the one case where the target is not a built site.
function spdd_target_dir() {
  printf '%s/%s' "$(spdd_root)" "$1";
}

# A slug that is safe as a directory name and still readable a month later.
function spdd_slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9]\+/-/g' -e 's/^-//' -e 's/-$//' | cut -c1-48 ;
}

# The next spec number for a target, zero-padded. Per target rather than global: the numbers are
# for reading, and "the third change to website_starter" is more useful than "the 47th spec".
function spdd_next_number() {
  local dir="$1" last;
  last="$(ls -1 "${dir}" 2>/dev/null | sed -n 's/^\([0-9]\{3\}\)-.*$/\1/p' | sort -n | tail -1)";
  printf '%03d' "$(( 10#${last:-0} + 1 ))";
}

# Resolve a spec by number, slug, or <workspace>/<project>/NNN-slug. Ambiguity is refused rather
# than guessed: the next command writes into whatever this returns.
function spdd_resolve() {
  local wanted="$1" base matches;
  base="$(spdd_root)";
  [ -d "${base}" ] || return 0 ;
  case "${wanted}" in
    *..*) return 0 ;;
    */*/*) [ -d "${base}/${wanted}" ] && printf '%s' "${base}/${wanted}" ; return 0 ;;
  esac
  matches="$(find "${base}" -mindepth 3 -maxdepth 3 -type d \( -name "${wanted}" -o -name "${wanted}-*" -o -name "*-${wanted}" \) 2>/dev/null | sort)";
  printf '%s' "${matches}";
}

function spdd_stage_of() {
  local spec="$1";
  sed -n 's/^stage:[[:space:]]*\([a-z]*\).*/\1/p' "${spec}/spec.yml" 2>/dev/null | head -1 ;
}

function spdd_field() {
  sed -n "s/^$2:[[:space:]]*//p" "$1/spec.yml" 2>/dev/null | head -1 ;
}

function spdd_set_field() {
  local spec="$1" field="$2" value="$3" tmp;
  tmp="$(mktemp)";
  if grep -q "^${field}:" "${spec}/spec.yml" 2>/dev/null ; then
    sed "s|^${field}:.*|${field}: ${value}|" "${spec}/spec.yml" > "${tmp}" && mv "${tmp}" "${spec}/spec.yml" ;
  else
    cp "${spec}/spec.yml" "${tmp}" 2>/dev/null ; printf '%s: %s\n' "${field}" "${value}" >> "${tmp}" ; mv "${tmp}" "${spec}/spec.yml" ;
  fi
}

# The governance block every generated artifact is written against, straight out of
# core/config/norms.yml so a rule is stated once.
function spdd_norms_block() {
  local file="${WORKSPACE_CONFIG}/norms.yml";
  if [ ! -f "${file}" ] ; then
    echo "(core/config/norms.yml is missing — the change has no stated norms or safeguards.)";
    return 0 ;
  fi
  cat "${file}";
}

# What the model is allowed to know about the target before it writes anything.
#
# Deterministic sources first, and clearly labelled: the graph is structure, the index is prose,
# and the tree listing is what actually exists. A model told "here is the structure" invents less
# than one told "figure out the structure".
function spdd_context() {
  local target="$1" workspace project project_path graph;
  workspace="${target%%/*}";
  project="${target##*/}";
  project_path="${WORKSPACE_ROOT}/${workspace}/${project}";

  echo "## The target";
  echo "";
  echo "${target}  (${project_path})";
  echo "";

  if [ -d "${project_path}" ] ; then
    echo "### Top-level layout";
    echo '```';
    ls -1 "${project_path}" 2>/dev/null | head -40 ;
    echo '```';
    echo "";
  fi

  graph="${WORKSPACE_ROOT}/graphs/${workspace}/${project}/graph.json";
  if [ -f "${graph}" ] ; then
    echo "### Structure (graphify knowledge graph)";
    echo "";
    echo "A graph exists at ${graph}. It maps PHP classes under src/, JS and SQL — NOT hooks in";
    echo "*.module/*.install, NOT Twig, NOT any *.yml. Query it with:";
    echo '```';
    echo "graphify query \"...\" --graph ${graph}";
    echo '```';
    echo "";
  fi

  # The RAG index covers exactly what the graph does not: prose, templates and configuration.
  # It is an enrichment, not a dependency: this workspace has no rag workspace yet, so the block
  # is skipped unless those functions are loaded. Checked explicitly rather than relying on the
  # errors being swallowed, so a missing index is a skipped section and not a hidden failure.
  if declare -f rag_resolve_instance > /dev/null 2>&1 \
     && command -v docker > /dev/null 2>&1 && [ -n "${SPDD_QUERY}" ] ; then
    local instance uri collection hits;
    instance="$(rag_resolve_instance "${workspace}" "${project}" '_settings_' 2>/dev/null)";
    if [ -n "${instance}" ] && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "ddev-${instance}-milvus-standalone" ; then
      collection="$(rag_collection_name "${workspace}" "${project}")";
      local doc_name_saved="${doc_name}"; doc_name="rag";
      uri="$(milvus_uri "${instance}")";
      doc_name="${doc_name_saved}";
      hits="$(rag_python --uri "${uri}" --token "$(milvus_token)" search --collection "${collection}" \
              --query "${SPDD_QUERY}" --limit 6 --context 14 2>/dev/null)";
      if [ -n "${hits}" ] ; then
        echo "### What the tree already says about this (RAG index, BM25)";
        echo '```';
        printf '%s\n' "${hits}";
        echo '```';
        echo "";
      fi
    fi
  fi
}

# Ask the Claude Code CLI for a draft, with the prompt on STDIN.
#
# Printed rather than run when the CLI is missing: a draft nobody can reproduce is not an
# artifact, and the point of the method is that the prompt is the thing you keep.
function spdd_draft() {
  local outfile="$1" title="$2";
  if ! command -v claude > /dev/null 2>&1 ; then
    echo "The claude CLI is not on PATH — writing the prompt to ${outfile}.prompt instead.";
    cat > "${outfile}.prompt";
    echo "Run it yourself with:  claude -p \"\$(cat ${outfile}.prompt)\" > ${outfile}";
    return 1 ;
  fi
  echo "Drafting ${title} — this calls the local Claude Code CLI and takes a minute.";
  # Tool-free print mode: this step writes a document, and a step that could also edit the tree
  # would blur which artifact the change came from.
  claude -p --allowed-tools "" > "${outfile}" || return 1 ;
  [ -s "${outfile}" ] || { echo "The draft came back empty — nothing written."; rm -f "${outfile}"; return 1 ; }
  return 0 ;
}

# ---------------------------------------------------------------------------
# The stages. Each one refuses to run until the one before it exists, because a
# canvas written from an unread analysis is the failure the method exists to prevent.
# ---------------------------------------------------------------------------

# Stage 1 — the story. Written by hand from a sentence, not by a model: the ask is the one thing
# nobody should be generating.
function spdd_story() {
  local target="${TARGET}" topic="${TOPIC}" dir slug number spec;
  if [ "${topic}" == '_none_' ] || [ -z "${topic}" ] ; then
    echo "Say what the change is: bash cmd-spdd.sh ${target} \"index a project into Milvus\"";
    return 1 ;
  fi
  case "${target}" in
    */*) : ;;
    *) echo "The target is <workspace>/<project>, e.g. products/webship_core or dev/myproject." ; return 1 ;;
  esac

  dir="$(spdd_target_dir "${target}")";
  mkdir -p "${dir}" ;
  slug="$(spdd_slug "${topic}")";
  number="$(spdd_next_number "${dir}")";
  spec="${dir}/${number}-${slug}";

  if [ -d "${spec}" ] ; then
    echo "${spec} already exists.";
    return 1 ;
  fi
  mkdir -p "${spec}" ;

  cat > "${spec}/spec.yml" <<YMLEOF
# What this spec is about, and how far it has got. Written by cmd-spdd.sh; edit by hand freely.
target: ${target}
topic: ${topic}
stage: story
created: $(date +%Y-%m-%d)
# The commit of the target the canvas was last true for; -a drift compares against it.
# (No backticks in this heredoc: it interpolates \${target}, so a backtick would run as a command.)
synced_commit:
# Fill these in when they exist, so a merged change can be traced back to the prompt it came from.
issue:
pull_request:
YMLEOF

  cat > "${spec}/01-story.md" <<STORYEOF
# ${topic}

## Problem / motivation

<!-- What is wrong or missing today, for whom, and why it is worth doing. Write it as if the
     reader has not been in the conversation this came from — in six months that reader is you. -->

## Scope

**In:**
-

**Out:**
-

## Definition of done

<!-- Observable outcomes, not tasks. "The dashboard row shows the bound server" — not
     "add a badge". Each of these becomes an acceptance criterion the Canvas maps operations to. -->
- [ ]
- [ ]

## Acceptance criteria

| # | Given | When | Then |
| - | ----- | ---- | ---- |
| 1 |       |      |      |
STORYEOF

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Spec ${number}-${slug} started for ${target}.";
  echo "";
  echo "    ${spec}/01-story.md";
  echo "";
  echo "  Write the story yourself — the ask is the one artifact nobody should generate.";
  echo "  Then:  bash cmd-spdd.sh ${target}/${number}-${slug} -a analysis";
  echo "*---------------------------------------------------------------------*";
}

# Stage 2 — the analysis. What already exists, what this touches, what could go wrong. Seeded with
# the graph and the RAG index rather than with a model's memory of the tree.
function spdd_analysis() {
  local spec="$1" target stage;
  target="$(spdd_field "${spec}" target)";
  stage="$(spdd_stage_of "${spec}")";
  [ -s "${spec}/01-story.md" ] || { echo "No story yet in ${spec}." ; return 1 ; }
  if grep -q '^## Problem / motivation$' "${spec}/01-story.md" && ! grep -qv '^\s*\(#\|<!--\|-\||\|\[\|$\)' "${spec}/01-story.md" ; then
    echo "01-story.md is still the empty template — write the ask before asking for an analysis.";
    return 1 ;
  fi

  SPDD_QUERY="$(spdd_field "${spec}" topic)";
  {
    echo "You are analysing a proposed change to the Webship Workspace, a DDEV-only Drupal";
    echo "development harness. Produce ONLY a markdown analysis document — no preamble, no code.";
    echo "";
    echo "Write these sections, and nothing else:";
    echo "  ## What exists today   — what is already there that this change touches or duplicates.";
    echo "  ## Domain vocabulary   — the words this change is about, as this codebase uses them.";
    echo "  ## What it touches     — files, commands and settings, as a list, with why each.";
    echo "  ## Risks               — what could break, and what is easy to get subtly wrong.";
    echo "  ## Open questions      — what a person must decide before a design is possible.";
    echo "";
    echo "State plainly when the provided context does not answer something. Do not invent a file";
    echo "path, a function name or a command that is not shown to you.";
    echo "";
    echo "# The ask";
    echo "";
    cat "${spec}/01-story.md";
    echo "";
    spdd_context "${target}";
    echo "# The rules this workspace holds to";
    echo "";
    spdd_norms_block;
  } | spdd_draft "${spec}/02-analysis.md" "the analysis" || return 1 ;

  spdd_set_field "${spec}" stage analysis ;
  echo "";
  echo "  Read and correct ${spec}/02-analysis.md — it is the input to the contract.";
  echo "  Then:  bash cmd-spdd.sh $(spdd_field "${spec}" target)/$(basename "${spec}") -a canvas";
}

# Stage 3 — the REASONS Canvas. The contract: requirements, entities, approach, structure,
# operations, norms, safeguards. Everything after this is generated FROM it.
function spdd_canvas() {
  local spec="$1" target;
  target="$(spdd_field "${spec}" target)";
  [ -s "${spec}/02-analysis.md" ] || { echo "No analysis yet — run -a analysis first." ; return 1 ; }

  SPDD_QUERY="$(spdd_field "${spec}" topic)";
  {
    echo "Write a REASONS Canvas for this change: the contract an implementation is generated from.";
    echo "Output ONLY the markdown document, starting at '# REASONS Canvas —'.";
    echo "";
    echo "Sections, in this order, each a '## ' heading:";
    echo "  ## R — Requirements   the why, the scope boundary, and the definition of done";
    echo "  ## E — Entities       the things involved and how they relate (a mermaid classDiagram";
    echo "                        when there is real structure; a table when there is not)";
    echo "  ## A — Approach       the strategy chosen, and what was rejected and why";
    echo "  ## S — Structure      which files, commands and settings, and how they fit what exists";
    echo "  ## O — Operations     ordered, individually reviewable steps. Each names the file it";
    echo "                        touches and states how it is verified. No step may be 'and so on'.";
    echo "  ## N — Norms          the standards below, as they apply HERE — not copied verbatim";
    echo "  ## S — Safeguards     the boundaries below, as they apply HERE, plus any specific to";
    echo "                        this change (what must not be deleted, what must stay reversible)";
    echo "";
    echo "Rules for you: every operation must trace to a definition-of-done item. If the analysis";
    echo "leaves a question open, say so in Requirements as an assumption rather than inventing an";
    echo "answer. Do not write an operation the analysis gives you no evidence is possible.";
    echo "";
    echo "# The ask";
    echo "";
    cat "${spec}/01-story.md";
    echo "";
    echo "# The analysis (already reviewed by a person)";
    echo "";
    cat "${spec}/02-analysis.md";
    echo "";
    spdd_context "${target}";
    echo "# The rules this workspace holds to";
    echo "";
    spdd_norms_block;
  } | spdd_draft "${spec}/03-canvas.md" "the REASONS Canvas" || return 1 ;

  spdd_set_field "${spec}" stage canvas ;
  spdd_set_field "${spec}" synced_commit "$(spdd_head_of "${target}")" ;
  echo "";
  echo "  Review ${spec}/03-canvas.md as a contract, not a draft: the operations are what gets built.";
  echo "  Then implement it — by hand, or by giving the canvas to a session:";
  echo "    claude \"Implement the operations in $(basename "${spec}")/03-canvas.md, one at a time.\"";
  echo "  And when the code and the canvas diverge:  -a drift  then  -a sync";
}

# The commit a target is at, when it is a git repository. A built Drupal site is not one, and that
# is fine — drift detection simply has nothing to compare and says so.
function spdd_head_of() {
  local target="$1" path;
  path="${WORKSPACE_ROOT}/${target}";
  git -C "${path}" rev-parse --short HEAD 2>/dev/null;
}

# Has the tree moved since the canvas was written? THE rule of the method is "fix the prompt
# first", and this is the only part of it a script can do: notice, and refuse to be quiet.
function spdd_drift() {
  local spec="$1" target synced now;
  target="$(spdd_field "${spec}" target)";
  synced="$(spdd_field "${spec}" synced_commit)";
  now="$(spdd_head_of "${target}")";

  echo "";
  echo "  spec:    $(basename "${spec}")";
  echo "  target:  ${target}";
  if [ -z "${now}" ] ; then
    echo "  status:  the target is not a git repository — drift cannot be measured here.";
    echo "           Re-read the canvas against the tree yourself before trusting it.";
    return 0 ;
  fi
  if [ -z "${synced}" ] ; then
    echo "  status:  no synced commit recorded. Set it once the canvas matches the tree:";
    echo "             bash cmd-spdd.sh $(basename "${spec}") -a sync";
    return 0 ;
  fi
  if [ "${synced}" == "${now}" ] ; then
    echo "  status:  in sync at ${now}.";
    return 0 ;
  fi
  echo "  status:  DRIFTED — canvas is true for ${synced}, the target is at ${now}.";
  echo "";
  git -C "${WORKSPACE_ROOT}/${target}" log --oneline "${synced}..${now}" 2>/dev/null | head -10 ;
  echo "";
  echo "  Fix the PROMPT first, then the code:";
  echo "    1. edit 03-canvas.md so it describes what is now true";
  echo "    2. bash cmd-spdd.sh $(basename "${spec}") -a sync";
  return 1 ;
}

# Record that the canvas has been made true again. Deliberately a separate, explicit act: a script
# that stamped this automatically would be recording an opinion nobody formed.
function spdd_sync() {
  local spec="$1" target now;
  target="$(spdd_field "${spec}" target)";
  now="$(spdd_head_of "${target}")";
  if [ -z "${now}" ] ; then
    echo "The target is not a git repository — nothing to stamp.";
    return 1 ;
  fi
  spdd_set_field "${spec}" synced_commit "${now}" ;
  echo "$(basename "${spec}") is recorded as true for ${target} at ${now}.";
}

function spdd_list() {
  local base spec target stage topic;
  base="$(spdd_root)";
  if [ -z "$(find "${base}" -mindepth 3 -maxdepth 3 -type d 2>/dev/null)" ] ; then
    echo "No specs yet. Start one from its target's workspace:";
    echo "  cd ${WORKSPACE_ROOT}/specs && bash cmd-spdd.sh <workspace>/<project> \"what the change is\"";
    return 0 ;
  fi
  printf '%-34s %-26s %-9s %s\n' "SPEC" "TARGET" "STAGE" "TOPIC";
  while read -r spec ; do
    [ -n "${spec}" ] || continue ;
    target="$(spdd_field "${spec}" target)";
    stage="$(spdd_stage_of "${spec}")";
    topic="$(spdd_field "${spec}" topic)";
    printf '%-34s %-26s %-9s %s\n' "$(basename "${spec}")" "${target}" "${stage:-?}" "${topic}";
  done <<< "$(find "${base}" -mindepth 3 -maxdepth 3 -type d 2>/dev/null | sort)"
}

# One spec, or a sentence saying why not. Sets SPDD_SPEC.
function spdd_require_spec() {
  local matches count;
  if [ "${SPEC_NAME}" == '_all_' ] || [ -z "${SPEC_NAME}" ] ; then
    echo "Name the spec: bash cmd-spdd.sh <spec> -a ${SPDD_ACTION}   ( -a list shows them )";
    return 1 ;
  fi
  matches="$(spdd_resolve "${SPEC_NAME}")";
  count="$(printf '%s' "${matches}" | grep -c . )";
  if [ "${count}" -eq 0 ] ; then echo "No spec matches '${SPEC_NAME}'." ; return 1 ; fi
  if [ "${count}" -gt 1 ] ; then
    echo "'${SPEC_NAME}' matches ${count} specs — name the target too:";
    while read -r m ; do printf '  %s\n' "${m#$(spdd_root)/}" ; done <<< "${matches}"
    return 1 ;
  fi
  SPDD_SPEC="${matches}";
  return 0 ;
}


# ---------------------------------------------------------------------------
# Writing, reading, reviewing — the three things the published method leaves to
# somebody's discipline, and the three that decide whether any of it is kept up.
# ---------------------------------------------------------------------------

# Where the shared templates live. A template that is a FILE can be reviewed, improved and shared;
# one that is a heredoc in this script can only be edited by whoever is willing to edit this script.
function spdd_default_template() {
  local name="$1" file;
  file="${WORKSPACE_ROOT}/specs/_defaults/${name}";
  [ -f "${file}" ] && echo "${file}" ;
}

# The general spec of a product: what it is, who for, what it must never become.
#
# SPDD as published has no such layer — it goes straight to a story — and the tool comparison
# (martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html) names the gap: every tool separates
# a "memory bank" of durable project context from the task-specific spec, and the ones that do not
# make people restate the context in every spec. Spec Kit calls it a constitution; so does this.
#
# It is a file per product, written by a person, revised rarely. This verb creates it from the
# template and otherwise gets out of the way — the one artifact nobody should generate is what the
# product IS.
function spdd_constitution() {
  local target="${SPEC_NAME}" dir file template;
  case "${target}" in
    */*) : ;;
    *) echo "Which product? bash cmd-spdd.sh products/webship -a constitution" ; return 1 ;;
  esac
  dir="$(spdd_target_dir "${target}")";
  file="${dir}/00-constitution.md";

  if [ -f "${file}" ] ; then
    echo "${file}";
    echo "";
    sed -n '1,40p' "${file}";
    echo "";
    echo "  (read it in full before writing any spec against ${target})";
    return 0 ;
  fi

  template="$(spdd_default_template 00-constitution.md)";
  if [ -z "${template}" ] ; then
    echo "No template at specs/_defaults/00-constitution.md — pull the shared specs first:";
    echo "  cd ${WORKSPACE_ROOT}/specs && bash cmd-tools-specs.sh --pull";
    return 1 ;
  fi
  mkdir -p "${dir}" ;
  sed "s|<Product>|${target##*/}|g" "${template}" > "${file}" ;
  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Constitution started for ${target}.";
  echo "";
  echo "    ${file}";
  echo "";
  echo "  Write it yourself. A constitution is the one document that outlives every";
  echo "  change to the product, and a generated one governs nothing.";
  echo "*---------------------------------------------------------------------*";
}

# Everything a session needs to implement this spec, as ONE document, in reading order.
#
# This is the "using" half, and it is the half that decides whether the artifacts were worth
# writing. A spec spread over four files is read by nobody at the moment it matters; `-a read`
# prints the constitution, the story, the analysis and the canvas in order, so the thing handed to
# a session — or to a person on their first day — is complete and in one piece.
function spdd_read() {
  local spec="$1" target constitution f;
  target="$(spdd_field "${spec}" target)";
  echo "# ${target} — $(spdd_field "${spec}" topic)";
  echo "";
  echo "_Stage: $(spdd_stage_of "${spec}"). Read in this order: what the product is, then the ask,";
  echo "then what the tree says, then the contract._";
  echo "";

  constitution="$(spdd_target_dir "${target}")/00-constitution.md";
  if [ -f "${constitution}" ] ; then
    echo "---";
    echo "";
    cat "${constitution}" ;
    echo "";
  else
    echo "> **No constitution for ${target}.** Nothing states what this product is, who it is for or";
    echo "> what it must never become, so nothing can say whether this change belongs in it.";
    echo "> Start one: bash cmd-spdd.sh ${target} -a constitution";
    echo "";
  fi

  for f in 01-story.md 02-analysis.md 03-canvas.md ; do
    if [ -f "${spec}/${f}" ] ; then
      echo "---";
      echo "";
      cat "${spec}/${f}" ;
      echo "";
    fi
  done
}

# The mechanical half of specs/_defaults/REVIEW.md.
#
# It never says "approved". A checklist can see that a section is missing, not that it is right —
# and the tool comparison's sharpest complaint is the review burden ("I'd rather review code than
# all these markdown files"), which is made worse, not better, by a tool that pretends to have done
# the reading. What this does is the part a person should not be spending attention on: is the
# scope boundary there, does every definition-of-done item have an operation, are all seven canvas
# sections present. What it cannot judge, it lists as what is left for the reviewer.
function spdd_review() {
  local spec="$1" target stage story canvas problems=0 notes=0 line;
  target="$(spdd_field "${spec}" target)";
  stage="$(spdd_stage_of "${spec}")";
  story="${spec}/01-story.md";
  canvas="${spec}/03-canvas.md";

  echo "";
  echo "Review — $(spdd_field "${spec}" topic)";
  echo "  ${spec}";
  echo "  target ${target}, stage ${stage}";
  echo "";

  # Gate 0 — the constitution.
  if [ -f "$(spdd_target_dir "${target}")/00-constitution.md" ] ; then
    echo "  ok    ${target} has a constitution to check this against";
  else
    echo "  NOTE  ${target} has no 00-constitution.md — nothing says whether this change belongs";
    notes=$((notes + 1));
  fi

  # Gate 1 — the story.
  if [ -f "${story}" ] ; then
    grep -q '^\*\*Out:\*\*' "${story}" && echo "  ok    the story has an Out list" || {
      echo "  MISS  the story has no **Out:** list — an In list alone constrains nothing";
      problems=$((problems + 1)); }
    if grep -qE '^- \[[ x]\]' "${story}" ; then
      echo "  ok    the story has a definition of done";
    else
      echo "  MISS  the story has no definition of done"; problems=$((problems + 1));
    fi
    grep -q 'Given | When | Then' "${story}" && echo "  ok    the story has acceptance criteria" || {
      echo "  MISS  the story has no Given/When/Then acceptance criteria"; problems=$((problems + 1)); }
  else
    echo "  MISS  no 01-story.md"; problems=$((problems + 1));
  fi

  # Gate 3 — the canvas: all seven sections, and every D-item served.
  if [ -f "${canvas}" ] ; then
    local missing='';
    for sec in 'R — Requirements' 'E — Entities' 'A — Approach' 'S — Structure' \
               'O — Operations' 'N — Norms' 'S — Safeguards' ; do
      grep -q "^## ${sec}" "${canvas}" || missing="${missing} ${sec%% *}";
    done
    if [ -z "${missing}" ] ; then
      echo "  ok    the canvas has all seven REASONS sections";
    else
      echo "  MISS  the canvas is missing section(s):${missing}"; problems=$((problems + 1));
    fi

    # Every D-item named in the canvas should be served by at least one operation row.
    local d unserved='';
    for d in $(grep -oE '^\| D[0-9]+' "${canvas}" | tr -d '| ' | sort -u) ; do
      grep -q "${d}" <(sed -n '/^## O — Operations/,/^## N —/p' "${canvas}") || unserved="${unserved} ${d}";
    done
    if [ -n "${unserved}" ] ; then
      echo "  MISS  no operation serves:${unserved} — out of scope, or forgotten? Decide in writing";
      problems=$((problems + 1));
    elif grep -q '^## O — Operations' "${canvas}" ; then
      echo "  ok    every definition-of-done item is served by an operation";
    fi
  elif [ "${stage}" == 'canvas' ] ; then
    echo "  MISS  stage says canvas, but there is no 03-canvas.md"; problems=$((problems + 1));
  fi

  # Has the tree moved under it? The drift check is part of the review, not a separate errand.
  local synced head;
  synced="$(spdd_field "${spec}" synced_commit)";
  if [ -n "${synced}" ] ; then
    head="$(spdd_head_of "${target}")";
    if [ -n "${head}" ] && [ "${head}" != "${synced}" ] ; then
      echo "  NOTE  the target has moved since the canvas was stamped (${synced} → ${head}) — -a drift";
      notes=$((notes + 1));
    fi
  fi

  echo "";
  echo "  What this cannot judge, and a reviewer must:";
  echo "    · is the problem stated as a problem, or already as its solution?";
  echo "    · does the analysis CONTRADICT the story anywhere? one that agrees with everything";
  echo "      was not an analysis";
  echo "    · does the approach name the alternatives it rejected, and why?";
  echo "    · is the ask inside the constitution's In-scope column?";
  echo "";
  if [ "${problems}" -gt 0 ] ; then
    echo "  ${problems} thing(s) to fix before this is ready to be read by somebody else.";
  else
    echo "  Nothing mechanical is missing. The reading above is still yours to do.";
  fi
  echo "  The full checklist: ${WORKSPACE_ROOT}/specs/_defaults/REVIEW.md";
  echo "";
  return 0 ;
}

function spdd_command() {
  case "${SPDD_ACTION}" in
    list)  spdd_list ;;
    story) TARGET="${SPEC_NAME}" ; spdd_story ;;
    # Takes a TARGET rather than a spec: a constitution is about the product, not about a change.
    constitution) spdd_constitution ;;
    analysis|canvas|drift|sync|show|read|review)
      spdd_require_spec || return 1 ;
      case "${SPDD_ACTION}" in
        analysis) spdd_analysis "${SPDD_SPEC}" ;;
        canvas)   spdd_canvas "${SPDD_SPEC}" ;;
        drift)    spdd_drift "${SPDD_SPEC}" ;;
        sync)     spdd_sync "${SPDD_SPEC}" ;;
        read)     spdd_read "${SPDD_SPEC}" ;;
        review)   spdd_review "${SPDD_SPEC}" ;;
        show)     echo "${SPDD_SPEC}" ; ls -1 "${SPDD_SPEC}" ;;
      esac
      ;;
    *) echo "Unknown action '${SPDD_ACTION}'." ; return 1 ;;
  esac
}
