#!/usr/bin/env bash

################################################################################
## Cutting a release of this tooling, with the version stamped BEFORE the tag.
################################################################################
## Releasing used to be a sequence somebody remembered: work out the next tag,
## `git tag -a`, push it, write the release notes, and then — separately, later,
## if at all — get the machines onto it. The stamp was the part that fell off.
## `core/workspace-app/.app-version` is what the dashboard reads to say which
## release it runs and which notes to link to, and nothing in the release wrote
## it, so the machine that cut 1.0.13 went on reporting 1.0.12 until someone
## thought to run the updater against a release they had just made themselves.
##
## A version that lags its own release is worse than no version: the rail shows a
## number, the number is wrong, and it links to the wrong notes.
##
## So the stamp is written first and the tag is cut from it. The order matters —
## if the tag went first and the stamp failed, the release would exist with the
## machines still reporting the old one, which is exactly the state this fixes.
##
## Nothing here is Webship-specific: the repository comes from `sources: tooling:`
## in settings.yml, so a fork releases itself.
################################################################################

# The repository this tooling releases to, from settings.yml rather than hardcoded.
function release_repo() {
  local host repo
  host="${sources_tooling_host:-github.com}"
  repo="${sources_tooling_repo:-}"
  repo="$(echo "${repo}" | tr -d '"'"'"'')"
  [ -n "${repo}" ] || { echo "No sources.tooling.repo in settings.yml." >&2 ; return 1 ; }
  [ "${host}" = 'github.com' ] || { echo "Only github.com is released to today; this tree points at ${host}." >&2 ; return 1 ; }
  echo "${repo}"
}

# The newest tag in the clone, by version order. Empty on a repository with none.
function release_current_tag() {
  local clone="${1:-}"
  git -C "${clone}" tag --sort=-v:refname 2>/dev/null | head -1
}

# The next tag: the last segment of the newest one, plus one. 1.0.12 -> 1.0.13.
# Never invents a shape — a tag this cannot read is refused rather than guessed at,
# because a tag is permanent and a wrong one cannot be taken back.
function release_next_tag() {
  local current="${1:-}"
  [ -n "${current}" ] || { echo "" ; return 1 ; }
  case "${current}" in
    *[!0-9.]*) echo "" ; return 1 ;;
  esac
  local head tail
  head="${current%.*}"
  tail="${current##*.}"
  [ "${head}" != "${current}" ] || { echo "" ; return 1 ; }
  [ -n "${tail}" ] || { echo "" ; return 1 ; }
  echo "${head}.$((tail + 1))"
}

# Is this clone releasable: on the branch, clean, and level with the remote?
# Each answer is printed, because "it refused" without the reason is a worse
# message than no message.
function release_ready() {
  local clone="${1}" branch="${2}" remote="${3:-github}" ok=0
  local on ahead behind
  on="$(git -C "${clone}" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  if [ "${on}" != "${branch}" ]; then
    echo "  ✗ the clone is on ${on:-nothing}, not ${branch}" ; ok=1
  else
    echo "  ✓ on ${branch}"
  fi
  if [ -n "$(git -C "${clone}" status --porcelain 2>/dev/null)" ]; then
    echo "  ✗ the clone has uncommitted changes — a tag would not say what is in it" ; ok=1
  else
    echo "  ✓ nothing uncommitted"
  fi
  git -C "${clone}" fetch -q "${remote}" 2>/dev/null
  ahead="$(git -C "${clone}" rev-list --count "${remote}/${branch}..HEAD" 2>/dev/null || echo '?')"
  behind="$(git -C "${clone}" rev-list --count "HEAD..${remote}/${branch}" 2>/dev/null || echo '?')"
  if [ "${ahead}" = '0' ] && [ "${behind}" = '0' ]; then
    echo "  ✓ level with ${remote}/${branch}"
  else
    echo "  ✗ ${ahead} ahead / ${behind} behind ${remote}/${branch} — push or pull first" ; ok=1
  fi
  return ${ok}
}

# The gate: the smoke test over every cmd-*.sh, and the dashboard's unit tests.
# A release that has not been run is a release nobody has tested.
function release_gate() {
  local clone="${1}" ok=0
  echo "Running the gate…"
  if bash "${WORKSPACE_SCRIPTS}/tests/cmd-smoke-test.sh" > /tmp/workspace-release-smoke.$$ 2>&1 ; then
    echo "  ✓ $(tail -2 /tmp/workspace-release-smoke.$$ | head -1 | sed 's/^ *//')"
  else
    echo "  ✗ the cmd smoke test failed:" ; tail -5 /tmp/workspace-release-smoke.$$ | sed 's/^/      /' ; ok=1
  fi
  rm -f /tmp/workspace-release-smoke.$$
  if [ -d "${WORKSPACE_PATH}/workspace-app/node_modules" ]; then
    if ( cd "${WORKSPACE_PATH}/workspace-app" && npm run --silent test:unit ) > /tmp/workspace-release-unit.$$ 2>&1 ; then
      echo "  ✓ dashboard unit tests: $(awk '/^ℹ pass/ {print $3; exit}' /tmp/workspace-release-unit.$$) passed"
    else
      echo "  ✗ the dashboard unit tests failed:" ; grep -E '^✖' /tmp/workspace-release-unit.$$ | head -5 | sed 's/^/      /' ; ok=1
    fi
    rm -f /tmp/workspace-release-unit.$$
  else
    echo "  · dashboard unit tests skipped (no node_modules in the live tree)"
  fi
  return ${ok}
}

# What a release WOULD do. Printed on its own by default: tagging and publishing
# are public and irreversible, so they are never a side effect of asking.
function release_plan() {
  local clone="${1}" branch="${2}" current="${3}" next="${4}" repo="${5}"
  echo ""
  echo "Release plan"
  echo "  repository   ${repo}"
  echo "  branch       ${branch} at $(git -C "${clone}" rev-parse --short "${branch}" 2>/dev/null)"
  echo "  current tag  ${current:-none}"
  echo "  next tag     ${next}"
  echo "  stamp        $(workspace_version_file) → ${next}"
  echo ""
  echo "  Since ${current:-the beginning}:"
  git -C "${clone}" log --oneline "${current}..${branch}" 2>/dev/null | sed 's/^/    /'
  echo ""
}

# Cut it. The stamp is written BEFORE the tag: if the stamp fails, nothing is
# published, and the tree is still honestly on the old release.
function release_cut() {
  local clone="${1}" branch="${2}" next="${3}" repo="${4}" notes="${5:-}" remote="${6:-github}"

  echo "Stamping this tree as ${next}…"
  workspace_version_stamp "${next}" || { echo "Could not write $(workspace_version_file) — nothing was tagged." >&2 ; return 1 ; }
  echo "  ✓ $(workspace_version_file)"

  local message
  message="$(printf 'Webship Workspace %s\n\n%s\n' "${next}" "$(git -C "${clone}" log --format='  %s' "$(release_current_tag "${clone}")..${branch}" 2>/dev/null)")"
  echo "Tagging ${next}…"
  git -C "${clone}" tag -a "${next}" "${branch}" -m "${message}" || { echo "The tag was refused — the stamp is written, the release is not." >&2 ; return 1 ; }
  git -C "${clone}" push -q "${remote}" "${next}" || { echo "The tag could not be pushed." >&2 ; return 1 ; }
  echo "  ✓ ${next} pushed to ${remote}"

  if command -v gh > /dev/null 2>&1 ; then
    if [ -n "${notes}" ] && [ -f "${notes}" ]; then
      gh release create "${next}" --repo "${repo}" --title "${next}" --notes-file "${notes}" --latest \
        && echo "  ✓ release published with your notes"
    else
      gh release create "${next}" --repo "${repo}" --title "${next}" --generate-notes --latest \
        && echo "  ✓ release published with generated notes — write the real ones over them"
    fi
  else
    echo "  · gh is not installed: the tag is pushed, the release page is not created."
  fi

  echo ""
  echo "Done. The dashboard reports ${next} on its next page load; other machines get it with:"
  echo "  bash core/workspace-app/scripts/update.sh"
}
