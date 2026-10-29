#!/usr/bin/env bash

# `--add <source>` and `--update`: the skills.sh verbs, on top of the lock file.
#
#   add     any GitHub repo -> ~/.claude (or one project's .claude/) + lock entry
#   update  re-copy every lock entry whose source moved, nothing else
#
# The Vardot repo keeps its own dedicated verb (--fetch, curated + filtered);
# --add is for everything else: a public skills repo, a client's repo, a fork.

# Normalize a source into "owner/repo<TAB>ref<TAB>subpath" (ref/subpath may be empty).
# Accepts: owner/repo, owner/repo@ref, https://github.com/owner/repo[.git],
# and https://github.com/owner/repo/tree/ref[/subpath].
function ai_items_parse_source() {
  local input="$1" owner_repo="" ref="" subpath="";

  case "${input}" in
    *github.com/*)
      local path="${input#*github.com/}"; path="${path%/}";
      if [[ "${path}" == */tree/* ]] ; then
        owner_repo="${path%%/tree/*}";
        local rest="${path#*/tree/}";
        ref="${rest%%/*}";
        [ "${rest}" != "${ref}" ] && subpath="${rest#*/}";
      else
        owner_repo="${path}";
      fi
      owner_repo="${owner_repo%.git}";
      ;;
    */*)
      owner_repo="${input}";
      if [[ "${owner_repo}" == *@* ]] ; then
        ref="${owner_repo##*@}"; owner_repo="${owner_repo%@*}";
      fi
      ;;
    *)
      echo "Not a source I can read: '${input}'. Use owner/repo, owner/repo@ref, or a github.com URL." >&2 ;
      return 1 ;
      ;;
  esac

  if ! echo "${owner_repo}" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' ; then
    echo "Not a source I can read: '${input}'. Use owner/repo, owner/repo@ref, or a github.com URL." >&2 ;
    return 1 ;
  fi
  if [[ "${subpath}" == *..* ]] ; then
    echo "Refusing subpath with '..': ${subpath}" >&2 ;
    return 1 ;
  fi
  printf '%s\t%s\t%s\n' "${owner_repo}" "${ref}" "${subpath}" ;
}

# Shallow-clone one repo@ref into a temp dir and print the dir. gh's credential
# helper covers private repos the caller can read; public ones need nothing.
function ai_items_clone_source() {
  local owner_repo="$1" ref="$2" tmp;
  tmp=$(mktemp -d) ;
  ensure_git_github_auth ;
  local ref_args=() ;
  [ -n "${ref}" ] && ref_args=(--branch "${ref}") ;
  if ! git clone --quiet --depth 1 "${ref_args[@]}" "https://github.com/${owner_repo}.git" "${tmp}/repo" 2>/dev/null ; then
    echo "Could not clone ${owner_repo}${ref:+@${ref}} — check the name, ref and access." >&2 ;
    rm -rf "${tmp}" ;
    return 1 ;
  fi
  echo "${tmp}/repo" ;
}

# Discover items of one kind in a checkout, as "name<TAB>path-in-repo" rows.
# Skills are directories holding a SKILL.md; agents and prompts are .md files.
# Container dirs cover the skills.sh conventions plus this workspace's own.
function ai_items_discover() {
  local kind="$1" root="$2" base="${3:-}";
  local search="${root}${base:+/${base}}";
  [ -d "${search}" ] || return 0 ;

  if [ "${kind}" == 'ai-skills' ] ; then
    # A subpath pointing straight at one skill.
    if [ -f "${search}/SKILL.md" ] && [ -n "${base}" ] ; then
      printf '%s\t%s\n' "$(basename "${search}")" "${base}" ;
      return 0 ;
    fi
    local d container;
    for container in "" "skills" ".claude/skills" ".agents/skills" ; do
      local dir="${search}${container:+/${container}}";
      [ -d "${dir}" ] || continue ;
      for d in "${dir}"/*/ ; do
        [ -f "${d}SKILL.md" ] || continue ;
        local rel="${d#${root}/}"; rel="${rel%/}";
        printf '%s\t%s\n' "$(basename "${d}")" "${rel}" ;
      done
    done
  else
    local container_names;
    if [ "${kind}" == 'ai-agents' ] ; then
      container_names=".claude/agents agents";
    else
      container_names=".claude/commands commands prompts";
    fi
    local f container;
    for container in ${container_names} ; do
      local dir="${search}/${container}";
      [ -d "${dir}" ] || continue ;
      for f in "${dir}"/*.md ; do
        [ -f "${f}" ] || continue ;
        case "$(basename "${f}")" in README.md|AGENTS.md|CLAUDE.md|RULES.md) continue ;; esac
        local rel="${f#${root}/}";
        printf '%s\t%s\n' "$(basename "${f}" .md)" "${rel}" ;
      done
    done
  fi | sort -u ;
}

# The skills.sh CLI (github.com/vercel-labs/skills) is the ecosystem's own installer
# for the skills kind — same SKILL.md format, richer source support, its own lock and
# `update`. Delegate to it when node is here; agents and prompts stay on the bash path
# because that CLI only handles skills. AI_ITEMS_NO_SKILLS_CLI=1 opts out.
function ai_items_skills_cli_available() {
  [ -n "${AI_ITEMS_NO_SKILLS_CLI}" ] && return 1 ;
  command -v npx > /dev/null 2>&1 ;
}

# DISABLE_TELEMETRY: the CLI reports installed skill names to skills.sh for its
# leaderboard — fine for public repos, not for client or private ones, so off always.
function ai_items_skills_cli_add() {
  local name="$1" source="$2" to="$3";
  local skill_filter="${name:-*}";
  [ "${skill_filter}" == '_all_' ] && skill_filter='*' ;
  echo "Using the skills.sh CLI (npx skills add) — its own lock manages these; agents and prompts stay on the workspace tooling." ;
  if [ -z "${to}" ] || [ "${to}" == '_none_' ] || [ "${to}" == 'claude' ] ; then
    DISABLE_TELEMETRY=1 npx -y skills add "${source}" --skill "${skill_filter}" -a claude-code --copy -g -y ;
  else
    local project_dir="${WORKSPACE_ROOT}/${to}";
    [ -d "${project_dir}" ] || { echo "No ${to}." >&2 ; return 1 ; }
    ( cd "${project_dir}" && DISABLE_TELEMETRY=1 npx -y skills add "${source}" --skill "${skill_filter}" -a claude-code --copy -y ) ;
  fi
}

function ai_items_skills_cli_update() {
  local to="$1";
  if [ -z "${to}" ] || [ "${to}" == '_none_' ] || [ "${to}" == 'claude' ] ; then
    DISABLE_TELEMETRY=1 npx -y skills update -g -y ;
  else
    local project_dir="${WORKSPACE_ROOT}/${to}";
    [ -d "${project_dir}" ] || return 0 ;
    ( cd "${project_dir}" && DISABLE_TELEMETRY=1 npx -y skills update -p -y ) ;
  fi
}

# Install items of one kind from any GitHub repo, and lock what was copied.
#   name    one item, or _all_/empty for everything discovered
#   source  owner/repo[@ref] or a github.com URL (tree URLs carry ref + subpath)
#   to      empty for ~/.claude, or <workspace>/<project>
function ai_items_add() {
  local kind="$1" name="$2" source="$3" to="${4:-}";
  name=$(ai_items_sanitize_name "${name}") || return 1 ;

  if [ "${kind}" == 'ai-skills' ] && ai_items_skills_cli_available ; then
    if ai_items_skills_cli_add "${name}" "${source}" "${to}" ; then
      return 0 ;
    fi
    echo "skills.sh CLI could not add it — falling back to the workspace installer." ;
  fi

  local parsed owner_repo ref subpath;
  parsed=$(ai_items_parse_source "${source}") || return 1 ;
  IFS=$'\t' read -r owner_repo ref subpath <<< "${parsed}" ;

  local target; target=$(ai_items_install_path "${kind}" "${to}") || return 1 ;
  local checkout; checkout=$(ai_items_clone_source "${owner_repo}" "${ref}") || return 1 ;
  local tmp_root; tmp_root=$(dirname "${checkout}") ;
  local ref_name; ref_name=$(git -C "${checkout}" rev-parse --abbrev-ref HEAD 2>/dev/null) ;

  local rows; rows=$(ai_items_discover "${kind}" "${checkout}" "${subpath}") ;
  if [ -z "${rows}" ]; then
    echo "No ${kind} found in ${owner_repo}${ref:+@${ref}}${subpath:+ under ${subpath}}." ;
    rm -rf "${tmp_root}" ;
    return 1 ;
  fi

  mkdir -p "${target}" ;
  local copied=0 skipped=0 item path;
  while IFS=$'\t' read -r item path ; do
    [ -z "${item}" ] && continue ;
    if [ -n "${name}" ] && [ "${name}" != '_all_' ] && [ "${item}" != "${name}" ] ; then continue ; fi
    # Discovered names come from a remote repo: same character rule as everywhere else.
    if ! echo "${item}" | grep -qE '^[a-zA-Z0-9_.-]+$' ; then
      echo "  skipping '${item}': unsafe name." ; skipped=$((skipped+1)) ; continue ;
    fi
    local sha; sha=$(git -C "${checkout}" rev-parse "HEAD:${path}" 2>/dev/null) ;
    if [ "${kind}" == 'ai-skills' ] ; then
      rsync -a --delete "${checkout}/${path}/" "${target}/${item}/" || { skipped=$((skipped+1)) ; continue ; }
    else
      cp "${checkout}/${path}" "${target}/" || { skipped=$((skipped+1)) ; continue ; }
    fi
    copied=$((copied+1)) ;
    [ -n "${sha}" ] && ai_items_lock_set "${target}" "${kind}" "${item}" \
      "${owner_repo}@${ref_name}" "repo" "${path}" "${sha}" ;
    echo "  + ${item}" ;
  done <<< "${rows}"
  rm -rf "${tmp_root}" ;

  if [ "${copied}" -eq 0 ]; then
    echo "No ${kind%s} '${name}' in ${owner_repo}${ref:+@${ref}} — nothing installed." ;
    return 1 ;
  fi
  echo "Added ${copied} ${kind} from ${owner_repo}${ref:+@${ref}} into ${target}." ;
  echo "Review third-party ${kind} before use — a session runs them with its full permissions." ;
  echo "Restart your Claude Code session to pick it up." ;
}

# Re-copy every lock entry of one kind whose source moved. Repo entries are
# grouped so each repo@ref clones once; workspace entries re-install from the
# draft. Nothing is touched when the recorded hash still matches.
function ai_items_update() {
  local kind="$1" name="${2:-}" to="${3:-}";
  local target; target=$(ai_items_install_path "${kind}" "${to}") || return 1 ;
  local lock_file; lock_file=$(ai_items_lock_file "${target}") ;

  # No workspace-tracked entries is not "nothing to do" for skills: the
  # skills.sh CLI keeps its own lock, and its update below still runs.
  local rows="";
  if [ -f "${lock_file}" ]; then
    rows=$(ai_items_lock_rows "${lock_file}" "${kind}" "${name}") ;
  fi
  if [ -z "${rows}" ]; then
    echo "Nothing workspace-tracked for '${name:-_all_}' at ${target}." ;
  fi

  local updated=0 checked=0 current_source="" checkout="" tmp_root="";
  local item_name source_type source source_path hash;

  # Sorting by source groups repo entries so one clone serves all of them.
  while IFS=$'\t' read -r item_name source_type source source_path hash ; do
    [ -z "${item_name}" ] && continue ;
    checked=$((checked+1)) ;

    if [ "${source_type}" == 'repo' ] ; then
      if [ "${source}" != "${current_source}" ] ; then
        [ -n "${tmp_root}" ] && rm -rf "${tmp_root}" ;
        checkout=$(ai_items_clone_source "${source%@*}" "${source##*@}") || { checkout=""; tmp_root=""; current_source="${source}"; continue ; }
        tmp_root=$(dirname "${checkout}") ;
        current_source="${source}";
      fi
      [ -n "${checkout}" ] || { printf "  %-32s %s\n" "${item_name}" "source unreachable" ; continue ; }
      local sha; sha=$(git -C "${checkout}" rev-parse "HEAD:${source_path}" 2>/dev/null) ;
      if [ -z "${sha}" ] ; then
        printf "  %-32s %s\n" "${item_name}" "removed upstream — left as is" ;
      elif [ "${sha}" == "${hash}" ] ; then
        printf "  %-32s %s\n" "${item_name}" "up to date" ;
      else
        if [ "${kind}" == 'ai-skills' ] ; then
          rsync -a --delete "${checkout}/${source_path}/" "${target}/${item_name}/" ;
        else
          cp "${checkout}/${source_path}" "${target}/" ;
        fi
        ai_items_lock_set "${target}" "${kind}" "${item_name}" "${source}" "repo" "${source_path}" "${sha}" ;
        updated=$((updated+1)) ;
        printf "  %-32s %s\n" "${item_name}" "updated" ;
      fi
    else
      local draft_path="${WORKSPACE_ROOT}/${source_path}";
      if [ ! -e "${draft_path}" ] ; then
        printf "  %-32s %s\n" "${item_name}" "draft removed — left as is" ;
        continue ;
      fi
      local new_hash; new_hash=$(ai_items_local_hash "${draft_path}") ;
      if [ "${new_hash}" == "${hash}" ] ; then
        printf "  %-32s %s\n" "${item_name}" "up to date" ;
      else
        if [ "${kind}" == 'ai-skills' ] ; then
          rsync -a "${draft_path}/" "${target}/${item_name}/" ;
        else
          cp "${draft_path}" "${target}/" ;
        fi
        ai_items_lock_set "${target}" "${kind}" "${item_name}" "workspace" "workspace" "${source_path}" "${new_hash}" ;
        updated=$((updated+1)) ;
        printf "  %-32s %s\n" "${item_name}" "updated from draft" ;
      fi
    fi
  done <<< "$(echo "${rows}" | sort -t$'\t' -k3,3)"

  [ -n "${tmp_root}" ] && rm -rf "${tmp_root}" ;
  echo "Checked ${checked}, updated ${updated}.";

  # Skills the skills.sh CLI installed live in ITS lock, not this one — its own
  # update covers them, after the workspace-tracked entries above. Its update has
  # no per-skill filter, so a NAMED update stays on the workspace lock alone
  # rather than refreshing every CLI-tracked skill as a side effect.
  if [ "${kind}" == 'ai-skills' ] && ai_items_skills_cli_available \
     && { [ -z "${name}" ] || [ "${name}" == '_all_' ] ; } ; then
    echo "skills.sh CLI (npx skills update):" ;
    ai_items_skills_cli_update "${to}" || echo "  (skills.sh CLI update failed — workspace-tracked items above are done)" ;
  fi

  [ "${updated}" -gt 0 ] && echo "Restart your Claude Code session to pick the updates up." ;
  return 0 ;
}
