#!/usr/bin/env bash

# Tracks what ai-items installed where, so a later run can tell "is this stale"
# without re-copying anything. One lock file per .claude root (global ~/.claude,
# or a project's own .claude/), covering agents, skills and prompts together.
#
# Two kinds of source get two kinds of hash, same split as skills.sh:
#   repo-sourced (ai_items_fetch, dest claude) -> the git object sha for that
#     path at the fetched ref. We already hold a local clone when fetching, so
#     `git rev-parse <ref>:<path>` gets it for free — no extra network call.
#   workspace-sourced (install_ai_item)        -> a local content hash of the
#     workspace draft, recomputed on check with no network at all.
#
# ai_items_check reads the lock and, only for entries still claiming a repo
# source, fetches the WHOLE remote tree once (one `gh api` call covers every
# item being checked) rather than one call per item.

function ai_items_lock_file() {
  local install_dir="$1";
  echo "$(dirname "${install_dir}")/.ai-items-lock.json" ;
}

# Local content hash: sha256 of a file, or a sorted hash-of-hashes for a directory.
# Deterministic across runs on the same content; not meant to match any external hash.
function ai_items_local_hash() {
  local path="$1";
  if [ -f "${path}" ]; then
    sha256sum "${path}" | awk '{print $1}' ;
  elif [ -d "${path}" ]; then
    find "${path}" -type f | LC_ALL=C sort | xargs sha256sum 2>/dev/null | sha256sum | awk '{print $1}' ;
  fi
}

# Add or update one item's entry in the lock file next to `install_dir`.
function ai_items_lock_set() {
  local install_dir="$1" kind="$2" name="$3" source="$4" source_type="$5" source_path="$6" hash="$7";
  local lock_file; lock_file=$(ai_items_lock_file "${install_dir}") ;
  python3 - "${lock_file}" "${kind}" "${name}" "${source}" "${source_type}" "${source_path}" "${hash}" <<'PYEOF'
import json, sys, pathlib, datetime
lock_file, kind, name, source, source_type, source_path, hash_ = sys.argv[1:8]
p = pathlib.Path(lock_file)
try:
    data = json.loads(p.read_text())
except Exception:
    data = {"version": 1, "items": {}}
data.setdefault("items", {})
key = f"{kind}:{name}"
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
existing = data["items"].get(key, {})
data["items"][key] = {
    "kind": kind,
    "name": name,
    "source": source,
    "sourceType": source_type,
    "sourcePath": source_path,
    "hash": hash_,
    "installedAt": existing.get("installedAt", now),
    "updatedAt": now,
}
p.parent.mkdir(parents=True, exist_ok=True)
p.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
PYEOF
}

# Rows of "name\tsourceType\tsource\tsourcePath\thash" for entries of one kind
# (optionally one name), read straight out of the lock file.
function ai_items_lock_rows() {
  local lock_file="$1" kind="$2" name="${3:-}";
  [ -f "${lock_file}" ] || return 0 ;
  python3 - "${lock_file}" "${kind}" "${name}" <<'PYEOF'
import json, sys
lock_file, kind, name = sys.argv[1:4]
try:
    data = json.loads(open(lock_file).read())
except Exception:
    data = {"items": {}}
for _, entry in sorted(data.get("items", {}).items()):
    if entry.get("kind") != kind:
        continue
    if name and name not in ("", "_all_") and entry.get("name") != name:
        continue
    print("\t".join([
        entry.get("name", ""), entry.get("sourceType", ""), entry.get("source", ""),
        entry.get("sourcePath", ""), entry.get("hash", ""),
    ]))
PYEOF
}

# Compare the lock against reality for one install location, without touching
# the installed files. Repo-sourced entries are checked against ONE fetched
# remote tree (whichever ref the entry itself recorded); workspace-sourced
# entries are checked against the current workspace draft, purely locally.
function ai_items_check() {
  local kind="$1" name="${2:-}" to="${3:-}";
  local target; target=$(ai_items_install_path "${kind}" "${to}") || return 1 ;
  if [ ! -d "${target}" ]; then
    echo "Nothing installed at ${target}." ;
    return 1 ;
  fi
  local lock_file; lock_file=$(ai_items_lock_file "${target}") ;
  if [ ! -f "${lock_file}" ]; then
    echo "No lock file at ${lock_file} — nothing workspace-tracked yet (installed before checking existed, or copied by hand).";
    ai_items_skills_cli_check "${kind}" "${to}" ;
    return 0 ;
  fi

  echo "*---------------------------------------------------------------------*";
  echo "  ${kind} — ${target}";
  echo "*---------------------------------------------------------------------*";

  local rows; rows=$(ai_items_lock_rows "${lock_file}" "${kind}" "${name}") ;
  if [ -z "${rows}" ]; then
    echo "  Nothing workspace-tracked for '${name:-_all_}'.";
    ai_items_skills_cli_check "${kind}" "${to}" ;
    return 0 ;
  fi

  local tree_json="" repo_checked="";
  local item_name source_type source source_path hash status remote_hash;

  while IFS=$'\t' read -r item_name source_type source source_path hash ; do
    [ -z "${item_name}" ] && continue ;
    status="unknown";
    if [ "${source_type}" == 'repo' ] ; then
      # One recursive tree fetch covers every repo-sourced item being checked —
      # cached per <repo>@<ref>, not re-fetched per item.
      if [ "${repo_checked}" != "${source}" ] ; then
        ensure_gh_cli > /dev/null 2>&1 ;
        local repo="${source%@*}" ref="${source##*@}";
        tree_json=$(gh api "repos/${repo}/git/trees/${ref}?recursive=1" 2>/dev/null) ;
        repo_checked="${source}";
      fi
      if [ -z "${tree_json}" ] ; then
        status="could not reach ${source}";
      else
        remote_hash=$(echo "${tree_json}" | jq -r --arg p "${source_path}" '.tree[]? | select(.path==$p) | .sha' 2>/dev/null) ;
        if [ -z "${remote_hash}" ] ; then
          status="removed upstream";
        elif [ "${remote_hash}" == "${hash}" ] ; then
          status="up to date";
        else
          status="update available";
        fi
      fi
    else
      # Workspace-sourced: recompute the draft's current hash, no network.
      local draft_path="${WORKSPACE_ROOT}/${source_path}";
      if [ ! -e "${draft_path}" ] ; then
        status="draft removed (${draft_path})";
      else
        remote_hash=$(ai_items_local_hash "${draft_path}") ;
        if [ "${remote_hash}" == "${hash}" ] ; then
          status="up to date";
        else
          status="draft changed since install";
        fi
      fi
    fi
    printf "  %-32s %-14s %s\n" "${item_name}" "(${source_type})" "${status}";
  done <<< "${rows}"

  ai_items_skills_cli_check "${kind}" "${to}" ;
  return 0 ;
}

# Skills the skills.sh CLI installed live in ITS lock — its own `check` covers them.
# Global scope only: that CLI's check reads ~/.agents/.skill-lock.json, not a project's.
function ai_items_skills_cli_check() {
  local kind="$1" to="$2";
  [ "${kind}" == 'ai-skills' ] || return 0 ;
  ai_items_skills_cli_available || return 0 ;
  if [ -n "${to}" ] && [ ! "${to}" == '_none_' ] && [ ! "${to}" == 'claude' ] ; then return 0 ; fi
  echo "skills.sh CLI (npx skills check):" ;
  DISABLE_TELEMETRY=1 npx -y skills check || echo "  (skills.sh CLI check failed — the workspace-tracked report above stands)" ;
}
