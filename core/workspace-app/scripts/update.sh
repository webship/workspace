#!/usr/bin/env bash

# Update the Webship Workspace dashboard app to a released tag.
#
#   bash core/workspace-app/scripts/update.sh --check       installed vs the latest tag
#   bash core/workspace-app/scripts/update.sh               update to the latest tag
#   bash core/workspace-app/scripts/update.sh --tag 1.0.3   pin a tag (any tarball-servable ref)
#   bash core/workspace-app/scripts/update.sh --dry-run     itemize, change nothing
#   bash core/workspace-app/scripts/update.sh --no-prompts  leave prompts/ alone
#   bash core/workspace-app/scripts/update.sh --prompts-only  sync only the prompts
#   bash core/workspace-app/scripts/update.sh --baseline 1.0.0  the version your prompts
#                                                           came from, when it cannot be told
#   bash core/workspace-app/scripts/update.sh --force-prompts  take the release's copy of
#                                                           every prompt, local edits included
#
# Deliberately SELF-CONTAINED: no workspace bootstrap, no argparse, no function
# library — the updater must never depend on the tooling it might be replacing.
# Plain bash + curl/gh + tar + rsync, and it locates the app from its own path.
#
# It updates core/workspace-app: runtime state survives (node_modules is kept
# unless package.json changed — then npm install runs in DDEV; actions.log,
# screenshots, test reports and the .app-version marker stay).
#
# It does NOT change your configuration. core/config and settings.yml are not
# its business at all, and inside the app the DDEV project's own identity is
# preserved across the update: its name, the hostnames derived from that name,
# any additional_fqdns and any router ports. A workspace called something else —
# a second checkout at ~/test1-workspace serving test1-workspace.ddev.site — must
# still be called that afterwards, or the update would point it at the first
# one's domains. Per-machine .ddev/config.*.yaml overrides are left alone too.
#
# It also brings the released PROMPT TEMPLATES into prompts/, because the New
# screen form and the Jira verbs offer them: a release that improves a prompt is
# useless if the prompt never reaches the machine. That folder is a staging area
# where prompts get worked on, so a prompt YOU have edited is never overwritten.
#
# "Edited" means edited, not "differs from the new release": every install and
# update records the checksum of each prompt as it shipped (.prompts-shipped),
# so a prompt still matching what came with the installed version is refreshed,
# and only one you actually changed is kept and reported. Before that file
# exists, the installed version's own prompts are fetched once to work it out —
# and if even that is not resolvable, differing prompts are kept, which is the
# safe way to be wrong. --force-prompts takes the release's copy regardless,
# --no-prompts skips the whole step.
#
# core/scripts, core/config, settings.yml and the other workspace folders belong
# to core/scripts/sync-tooling.sh, never to this script.

set -u

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION_FILE="${APP_DIR}/.app-version"
SHIPPED_FILE="${APP_DIR}/.prompts-shipped"
REPO="webship/workspace"
TAG=""
CHECK="no"
DRY_RUN="no"
PROMPTS="yes"
PROMPTS_ONLY="no"
BASELINE=""
FORCE_PROMPTS="no"
ROOT="$(cd "${APP_DIR}/../.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    -t|--tag)     TAG="${2:-}"; shift 2 ;;
    -r|--repo)    REPO="${2:-}"; shift 2 ;;
    -c|--check)   CHECK="yes"; shift ;;
    -n|--dry-run) DRY_RUN="yes"; shift ;;
    --no-prompts) PROMPTS="no"; shift ;;
    --prompts-only) PROMPTS_ONLY="yes"; shift ;;
    --baseline) BASELINE="${2:-}"; shift 2 ;;
    --force-prompts) FORCE_PROMPTS="yes"; shift ;;
    -h|--help)
      sed -n '3,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

installed="(untracked)"
[ -f "${VERSION_FILE}" ] && installed="$(cat "${VERSION_FILE}")"
# What the prompts on disk came with. It is the installed version UNLESS this run
# is the second half of an update that already bumped it — hence --baseline, which
# the re-exec passes through with the value from before the bump.
[ -z "${BASELINE}" ] && BASELINE="${installed}"

have_gh="no"
command -v gh > /dev/null 2>&1 && gh auth status > /dev/null 2>&1 && have_gh="yes"

# The newest tag, by version order — resolved only when needed, so an explicit
# --tag works before the first release exists.
latest="(no tags yet)"
if [ -z "${TAG}" ] || [ "${CHECK}" = "yes" ]; then
  if [ "${have_gh}" = "yes" ]; then
    found=$(gh api "repos/${REPO}/tags" --jq '.[].name' 2>/dev/null | sort -V | tail -1)
  else
    found=$(curl -fsSL "https://api.github.com/repos/${REPO}/tags" 2>/dev/null \
      | grep -o '"name": *"[^"]*"' | cut -d'"' -f4 | sort -V | tail -1)
  fi
  [ -n "${found}" ] && latest="${found}"
fi

wanted="${TAG:-${found:-}}"

echo "Installed: ${installed}"
echo "Latest:    ${latest}"
if [ "${CHECK}" = "yes" ]; then
  if [ "${latest}" = "(no tags yet)" ]; then
    echo "Releases have not started (or no access) — nothing to compare."
  elif [ "${installed}" = "${latest}" ]; then
    echo "Up to date."
  else
    echo "An update is available: bash ${BASH_SOURCE[0]} --tag ${latest}"
  fi
  exit 0
fi
if [ -z "${wanted}" ]; then
  echo "No tags found on ${REPO} — nothing to update from (releases have not started, or no access)."
  exit 1
fi
if [ "${installed}" = "${wanted}" ] && [ "${DRY_RUN}" = "no" ] && [ "${PROMPTS}" = "no" ]; then
  echo "Already on ${wanted} — nothing to do."
  exit 0
fi
# Being on the version is not the same as having its prompts — which is exactly
# what happens the first time a release adds a step to this script.
if [ "${installed}" = "${wanted}" ] && [ "${PROMPTS_ONLY}" = "no" ]; then
  echo "The app is already on ${wanted} — checking the prompts."
  PROMPTS_ONLY="yes"
fi

workdir=$(mktemp -d)
trap 'rm -rf "${workdir}"' EXIT
echo "Downloading ${REPO}@${wanted}…"
if [ "${have_gh}" = "yes" ]; then
  gh api "repos/${REPO}/tarball/${wanted}" > "${workdir}/app.tar.gz" || exit 1
else
  curl -fsSL "https://api.github.com/repos/${REPO}/tarball/${wanted}" -o "${workdir}/app.tar.gz" || exit 1
fi
tar -xzf "${workdir}/app.tar.gz" -C "${workdir}"
extracted=$(find "${workdir}" -maxdepth 1 -type d ! -path "${workdir}" | head -1)
if [ ! -d "${extracted}/core/workspace-app" ]; then
  echo "The tag's tarball carries no core/workspace-app — refusing."
  exit 1
fi

deps_changed="no"
cmp -s "${extracted}/core/workspace-app/package.json" "${APP_DIR}/package.json" || deps_changed="yes"
ddev_changed="no"
diff -rq "${extracted}/core/workspace-app/.ddev" "${APP_DIR}/.ddev" > /dev/null 2>&1 || ddev_changed="yes"

updater_changed="no"
cmp -s "${extracted}/core/workspace-app/scripts/update.sh" "${BASH_SOURCE[0]}" || updater_changed="yes"

rsync_flags="-a --itemize-changes"
[ "${DRY_RUN}" = "yes" ] && rsync_flags="${rsync_flags} --dry-run"
if [ "${PROMPTS_ONLY}" = "yes" ]; then
  echo "Only the prompts this time — ${APP_DIR} is already on ${wanted}."
else
  # The DDEV project's identity, read before the release's config lands on top.
  ddev_config="${APP_DIR}/.ddev/config.yaml"
  local_name="" ; local_fqdns="" ; local_http="" ; local_https=""
  if [ -f "${ddev_config}" ]; then
    local_name=$(grep -m1 '^name:' "${ddev_config}" | sed 's/^name: *//')
    local_fqdns=$(grep -m1 '^additional_fqdns:' "${ddev_config}")
    local_http=$(grep -m1 '^router_http_port:' "${ddev_config}")
    local_https=$(grep -m1 '^router_https_port:' "${ddev_config}")
  fi

  echo "Updating ${APP_DIR} (runtime state survives)…"
  rsync ${rsync_flags} --delete \
    --filter='protect .ddev/config.*.yaml' \
    --exclude=node_modules --exclude=actions.log --exclude=logs --exclude=.app-version \
    --exclude=.prompts-shipped --exclude=.chats --exclude=.memory --exclude=.voice-cache \
    --exclude=screenshots --exclude='tests/reports' --exclude='.playwright-mcp' \
    "${extracted}/core/workspace-app/" "${APP_DIR}/"

  # Put the project's identity back. The hostnames are patterns built from the
  # name (*.dev.<name>), so they are renamed with it — otherwise this checkout
  # would answer on another one's domains.
  if [ "${DRY_RUN}" = "no" ] && [ -n "${local_name}" ] && [ -f "${ddev_config}" ]; then
    shipped_name=$(grep -m1 '^name:' "${ddev_config}" | sed 's/^name: *//')
    if [ "${shipped_name}" != "${local_name}" ]; then
      sed -i "1,/^name:/ s/^name: .*/name: ${local_name}/" "${ddev_config}"
      sed -i "s/^\(- \"\*\..*\)${shipped_name}\"$/\1${local_name}\"/" "${ddev_config}"
      echo "Kept this workspace's DDEV project name: ${local_name}"
    fi
    [ -n "${local_fqdns}" ] && sed -i "s/^additional_fqdns:.*/${local_fqdns}/" "${ddev_config}"
    [ -n "${local_http}" ] && sed -i "s/^router_http_port:.*/${local_http}/" "${ddev_config}"
    [ -n "${local_https}" ] && sed -i "s/^router_https_port:.*/${local_https}/" "${ddev_config}"
  fi
fi

# The release brought a newer updater and the one running is the old one, so the
# steps the new version adds would be skipped in the very release that adds
# them. Hand the rest of the job to the new script, once.
if [ "${PROMPTS_ONLY}" = "no" ] && [ "${DRY_RUN}" = "no" ] && [ "${updater_changed}" = "yes" ] \
   && [ -z "${WORKSPACE_UPDATE_REEXEC:-}" ] && [ -f "${APP_DIR}/scripts/update.sh" ] \
   && grep -q -- '--prompts-only' "${APP_DIR}/scripts/update.sh"; then
  echo "${wanted}" > "${VERSION_FILE}"
  echo "The updater changed in ${wanted} — finishing with the new one."
  extra=""
  [ "${FORCE_PROMPTS}" = "yes" ] && extra="--force-prompts"
  WORKSPACE_UPDATE_REEXEC=1 exec bash "${APP_DIR}/scripts/update.sh" \
    --repo "${REPO}" --tag "${wanted}" --prompts-only --baseline "${installed}" ${extra}
fi

# This machine's Docker access, put back.
#
# The release's .ddev/ lands on top of the local one, and TWO files in it are
# per-machine, written by core/scripts/docker-gid.sh rather than by hand:
# docker-compose.dood.yaml (group_add — the GID the running process is granted)
# and web-build/Dockerfile.workspace-app (the GID the group is created with).
# The shipped values are placeholders.
#
# Nothing here noticed. The project NAME, ports and fqdns were carefully restored
# and the GID was not, so every supported update left the dashboard with a docker
# GID that is not this host's — and the failure is silent until the next
# `ddev restart`, when the container loses access to docker.sock and the dashboard
# reports EVERY project as Stopped while they all run perfectly well. That is an
# hour of debugging a fault that is not one, once per machine, per update.
#
# sync-tooling.sh has always re-run docker-gid.sh after mirroring, for exactly this
# reason. The updater has to as well: it is the path a machine on releases uses,
# and it is the only one those machines have.
if [ "${DRY_RUN}" = "no" ]; then
  if [ -f "${ROOT}/core/scripts/docker-gid.sh" ]; then
    bash "${ROOT}/core/scripts/docker-gid.sh" > /dev/null 2>&1 \
      && echo "Docker GID re-applied for this host." \
      || echo "⚠️  Could not re-apply the docker GID: bash core/scripts/docker-gid.sh"
  else
    # A tree with the app but not the tooling. Say it plainly rather than leave a
    # dashboard that will go blind on its next restart with no clue why.
    echo "⚠️  core/scripts/docker-gid.sh is not here, so this release's placeholder"
    echo "    docker GID is in place. On the next 'ddev restart' the dashboard will"
    echo "    show every project as Stopped. Fix it with:"
    echo "      bash core/scripts/sync-tooling.sh --pull"
  fi
fi

# The prompt templates the dashboard offers. New ones arrive, ones still as they
# shipped are refreshed, and anything YOU edited stays exactly as it is: this
# folder is where prompts are written, not only where they are installed.
if [ "${PROMPTS}" = "yes" ] && [ -d "${extracted}/prompts" ]; then
  mkdir -p "${ROOT}/prompts"

  # What the installed version shipped, so "edited" can mean edited rather than
  # "differs from the new release" — without it, every improved prompt would be
  # kept out forever on an install nobody has touched.
  if [ ! -f "${SHIPPED_FILE}" ] && [ "${BASELINE}" != "(untracked)" ] && [ "${BASELINE}" != "${wanted}" ]; then
    echo "Working out which prompts you have edited (fetching ${BASELINE})…"
    if [ "${have_gh}" = "yes" ]; then
      gh api "repos/${REPO}/tarball/${BASELINE}" > "${workdir}/installed.tar.gz" 2>/dev/null
    else
      curl -fsSL "https://api.github.com/repos/${REPO}/tarball/${BASELINE}" -o "${workdir}/installed.tar.gz" 2>/dev/null
    fi
    if [ -s "${workdir}/installed.tar.gz" ]; then
      mkdir -p "${workdir}/installed" && tar -xzf "${workdir}/installed.tar.gz" -C "${workdir}/installed" 2>/dev/null
      base=$(find "${workdir}/installed" -maxdepth 2 -type d -name prompts | head -1)
      if [ -n "${base}" ]; then
        : > "${workdir}/shipped"
        for old_prompt in "${base}"/*.md ; do
          [ -e "${old_prompt}" ] || continue
          printf '%s  %s\n' "$(sha256sum "${old_prompt}" | cut -d' ' -f1)" "$(basename "${old_prompt}")" >> "${workdir}/shipped"
        done
        [ "${DRY_RUN}" = "no" ] && cp "${workdir}/shipped" "${SHIPPED_FILE}"
        SHIPPED_LIST="${workdir}/shipped"
      fi
    fi
  fi
  [ -z "${SHIPPED_LIST:-}" ] && [ -f "${SHIPPED_FILE}" ] && SHIPPED_LIST="${SHIPPED_FILE}"

  # Did this prompt arrive with the installed version and stay untouched?
  as_shipped() {
    [ -n "${SHIPPED_LIST:-}" ] || return 1
    local want ; want=$(grep -F "  $1" "${SHIPPED_LIST}" 2>/dev/null | head -1 | cut -d' ' -f1)
    [ -n "${want}" ] || return 1
    [ "${want}" = "$(sha256sum "$2" | cut -d' ' -f1)" ]
  }

  added=0 ; updated=0 ; kept=0
  for src in "${extracted}"/prompts/*.md ; do
    [ -e "${src}" ] || continue
    name="$(basename "${src}")"
    dest="${ROOT}/prompts/${name}"
    if [ ! -e "${dest}" ]; then
      [ "${DRY_RUN}" = "no" ] && cp "${src}" "${dest}"
      added=$((added + 1)) ; echo "  new prompt: ${name}"
    elif cmp -s "${src}" "${dest}" ; then
      : # already the released one
    elif [ "${FORCE_PROMPTS}" = "yes" ] || as_shipped "${name}" "${dest}" ; then
      [ "${DRY_RUN}" = "no" ] && cp "${src}" "${dest}"
      updated=$((updated + 1)) ; echo "  updated:    ${name}"
    else
      kept=$((kept + 1)) ; echo "  yours, kept: ${name}"
    fi
  done

  # Record what this version ships, so the next update knows the same thing
  # without fetching anything.
  if [ "${DRY_RUN}" = "no" ]; then
    : > "${SHIPPED_FILE}"
    for src in "${extracted}"/prompts/*.md ; do
      [ -e "${src}" ] || continue
      printf '%s  %s\n' "$(sha256sum "${src}" | cut -d' ' -f1)" "$(basename "${src}")" >> "${SHIPPED_FILE}"
    done
  fi

  echo "Prompts: ${added} new, ${updated} updated, ${kept} left as yours."
  if [ "${kept}" -gt 0 ]; then
    if [ -n "${SHIPPED_LIST:-}" ]; then
      echo "  (take the release's copy of those too with --force-prompts)"
    else
      echo "  Nothing to compare them against, so they were all kept. If you have not edited them,"
      echo "  re-run with --baseline <the version they came from>, or --force-prompts."
    fi
  fi
fi

if [ "${DRY_RUN}" = "yes" ]; then
  echo "(dry run — nothing was changed)"
  exit 0
fi
echo "${wanted}" > "${VERSION_FILE}"
if [ "${PROMPTS_ONLY}" = "yes" ]; then
  echo ""
  echo "*---------------------------------------------------------------------*"
  echo "  The dashboard app is on ${wanted}, prompts included."
  echo "*---------------------------------------------------------------------*"
  exit 0
fi

if [ "${deps_changed}" = "yes" ]; then
  echo "package.json changed — installing dependencies…"
  (cd "${APP_DIR}" && ddev exec npm install --no-audit --no-fund) \
    || echo "npm install failed — run it in ${APP_DIR} yourself."
fi
if [ "${ddev_changed}" = "yes" ]; then
  echo ""
  echo "⚠️  .ddev/ changed in this release — a full restart is needed:"
  echo "    cd ${APP_DIR} && ddev restart"
else
  echo "Restarting the app…"
  (cd "${APP_DIR}" && ddev exec supervisorctl restart webextradaemons:workspace-app) > /dev/null 2>&1 || true
fi
echo ""
echo "*---------------------------------------------------------------------*"
echo "  The dashboard app is on ${wanted}."
echo "*---------------------------------------------------------------------*"
