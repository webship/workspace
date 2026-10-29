#!/usr/bin/env bash

# Cut the next release of this tooling: stamp the version, tag the branch, publish
# the release. The stamp is written BEFORE the tag, so a machine can never be on a
# release while still reporting the one before it.
#
# Confirm-gated: without --confirm it prints the plan and creates nothing. A tag
# and a release page are public and permanent, and neither should be a side effect
# of asking what would happen.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

ARGPARSE_DESCRIPTION="Release the next tag of this tooling (stamps the version first)"
source ${WORKSPACE_SCRIPTS}/args/arg-release.sh || exit 1 ;

shift $#;

CLONE="${WORKSPACE_ROOT}/products/workspace"
REMOTE='github'

if [ ! -d "${CLONE}/.git" ]; then
  echo "No clone at ${CLONE}. Releases are cut from the git checkout, not from the live tree." >&2
  exit 1
fi

REPO="$(release_repo)" || exit 1

echo "Checking the clone…"
release_ready "${CLONE}" "${BRANCH}" "${REMOTE}" || READY=1

CURRENT="$(release_current_tag "${CLONE}")"
if [ -n "${TAG}" ]; then
  NEXT="${TAG}"
else
  NEXT="$(release_next_tag "${CURRENT}")"
  if [ -z "${NEXT}" ]; then
    echo "Cannot work out the next tag from '${CURRENT:-none}'. Name one with --tag." >&2
    exit 1
  fi
fi

if git -C "${CLONE}" rev-parse -q --verify "refs/tags/${NEXT}" > /dev/null 2>&1 ; then
  echo "${NEXT} already exists. A released tag is never moved." >&2
  exit 1
fi

release_plan "${CLONE}" "${BRANCH}" "${CURRENT}" "${NEXT}" "${REPO}"

if [ "${NO_GATE}" != 'yes' ]; then
  release_gate "${CLONE}" || GATED=1
else
  echo "Gate skipped (--no-gate)."
fi

if [ "${CONFIRM}" != 'yes' ]; then
  echo "Nothing was created. Add --confirm to cut ${NEXT}."
  exit 0
fi

if [ -n "${READY}" ] || [ -n "${GATED}" ]; then
  echo "" >&2
  echo "Refusing to release: the checks above did not pass." >&2
  exit 1
fi

release_cut "${CLONE}" "${BRANCH}" "${NEXT}" "${REPO}" "${NOTES}" "${REMOTE}"
