#!/usr/bin/env bash

################################################################################
## Webship Workspace — make sure the host paths the dashboard mounts are YOURS
################################################################################
## The dashboard shares things from the host by bind-mounting them into its
## container: your Claude Code login, your gh auth, DDEV's project registry, the
## Teamwork Graph CLI, the Upsun CLI. Docker has one behaviour that turns every
## one of those into a trap:
##
##   a bind mount whose SOURCE does not exist is CREATED — as a directory,
##   owned by root.
##
## So on a machine that has not installed twg, the first `ddev start` creates
## `~/.local/bin/twg` as a root-owned directory, and `~/.local/bin` with it. Then:
##
##   - the dashboard's Jira gate sees a directory where a binary should be, so
##     the JIRA button never appears, however complete `jira:` in settings.yml is;
##   - `~/.local/bin` is no longer yours, so nothing can install a user binary
##     there — including the `drupal-ci-local` wrapper the GitLab CI green-gate
##     writes on `--doctor`;
##   - and installing twg to that exact path fails, on a machine that looks like
##     it is merely missing a tool.
##
## Creating each path as you, BEFORE Docker can, avoids all of it. Run from the
## dashboard's own `pre-start` hook, so it happens on every start, and from
## install.sh during setup.
##
##   bash core/scripts/host-mounts.sh            create what is missing
##   bash core/scripts/host-mounts.sh --check    report, change nothing
##   bash core/scripts/host-mounts.sh --quiet     only speak when something is wrong
##   bash core/scripts/host-mounts.sh --sudo      also repair root-owned paths (asks for
##                                               your password) — what install.sh uses
##
## Self-contained plain bash, like trust-https.sh and docker-gid.sh beside it: it
## runs before the container exists and must not depend on anything in it.
################################################################################

set -u

CHECK_ONLY='no'
QUIET='no'
USE_SUDO='no'
while [ $# -gt 0 ]; do
  case "$1" in
    -c|--check) CHECK_ONLY='yes'; shift ;;
    -q|--quiet) QUIET='yes'; shift ;;
    -s|--sudo)  USE_SUDO='yes'; shift ;;
    -h|--help)  sed -n '3,32p' "${BASH_SOURCE[0]}" | sed 's/^## \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

function say()  { [ "${QUIET}" == 'yes' ] || echo "$@" ; }
function warn() { echo "$@" ; }

# Repairing a root-owned path needs root, and asking for a password is only acceptable
# where a person is already answering prompts — install.sh. The `pre-start` hook calls
# this WITHOUT --sudo, so a project start never blocks on a password.
function can_sudo() {
  [ "${USE_SUDO}" == 'yes' ] || return 1
  command -v sudo > /dev/null 2>&1 || return 1
  return 0
}

MADE=0
PROBLEMS=0

# Directories to own. Each is a bind source in one of the .ddev/docker-compose.*.yaml
# overrides, and each is optional in the sense that the tool behind it may not be
# installed — which is exactly when Docker would create it as root.
DIRS=(
  "${HOME}/.claude"          # Claude Code's config, for the assistant chat
  "${HOME}/.config/gh"       # gh auth, for the private dev-ai-agents repo
  "${HOME}/.config/twg"      # Teamwork Graph CLI session (Jira)
  "${HOME}/.local/bin"       # where user binaries live: twg, drupal-ci-local
)

# Files to own. A missing file mount is the same trap, and an empty file is the
# right stand-in for these two: both are written by the tool that owns them.
# What installed plugins mount (core/scripts/plugins/<name>/host-mounts.txt, one path per line,
# ~ allowed): the same trap, so the same ownership.
for plugin_mounts in "$(dirname "${BASH_SOURCE[0]}")"/plugins/*/host-mounts.txt ; do
  [ -f "${plugin_mounts}" ] || continue ;
  while IFS= read -r mount_line ; do
    mount_line="${mount_line%%#*}"; mount_line="${mount_line// /}" ;
    [ -n "${mount_line}" ] || continue ;
    DIRS+=("${mount_line/#\~/${HOME}}") ;
  done < "${plugin_mounts}" ;
done

FILES=(
  "${HOME}/.claude.json"     # Claude Code's project state
)

for d in "${DIRS[@]}" ; do
  if [ -d "${d}" ] ; then
    owner="$(stat -c %U "${d}" 2>/dev/null)"
    if [ "${owner}" == "$(id -un)" ] ; then
      say "  ✓ ${d/#${HOME}/~}"
    else
      # Already root-owned: Docker got there first. Only root can hand it back.
      if [ "${CHECK_ONLY}" != 'yes' ] && can_sudo ; then
        warn "  → ${d/#${HOME}/~} is owned by ${owner} — taking it back (sudo may ask for your password)"
        if sudo chown -R "$(id -un):$(id -gn)" "${d}" ; then
          say "  ✓ ${d/#${HOME}/~} — now yours"
          MADE=$((MADE + 1))
        else
          warn "  ✗ chown failed on ${d} — run it yourself:  sudo chown -R $(id -un):$(id -gn) ${d}"
          PROBLEMS=$((PROBLEMS + 1))
        fi
      else
        warn "  ✗ ${d/#${HOME}/~} is owned by ${owner}, not you — Docker created it for a bind mount."
        warn "    Take it back:  sudo chown -R $(id -un):$(id -gn) ${d}"
        PROBLEMS=$((PROBLEMS + 1))
      fi
    fi
    continue
  fi
  if [ "${CHECK_ONLY}" == 'yes' ] ; then
    warn "  ✗ ${d/#${HOME}/~} is missing — Docker would create it as root."
    PROBLEMS=$((PROBLEMS + 1))
    continue
  fi
  if mkdir -p "${d}" 2>/dev/null ; then
    say "  ✓ ${d/#${HOME}/~} — created"
    MADE=$((MADE + 1))
  else
    warn "  ✗ could not create ${d}"
    PROBLEMS=$((PROBLEMS + 1))
  fi
done

for f in "${FILES[@]}" ; do
  if [ -e "${f}" ] ; then
    say "  ✓ ${f/#${HOME}/~}"
    continue
  fi
  if [ "${CHECK_ONLY}" == 'yes' ] ; then
    warn "  ✗ ${f/#${HOME}/~} is missing — Docker would create it as a root-owned DIRECTORY."
    PROBLEMS=$((PROBLEMS + 1))
    continue
  fi
  if touch "${f}" 2>/dev/null ; then
    say "  ✓ ${f/#${HOME}/~} — created"
    MADE=$((MADE + 1))
  else
    warn "  ✗ could not create ${f}"
    PROBLEMS=$((PROBLEMS + 1))
  fi
done

# The twg binary is mounted as a FILE, and it is deliberately NOT created here: an
# empty file would be executable-shaped and the dashboard would offer a Jira button
# for a CLI that cannot run. What can be cleared is the root-owned directory Docker
# left in its place, which otherwise blocks installing twg there.
TWG="${HOME}/.local/bin/twg"
if [ -d "${TWG}" ] ; then
  if [ -n "$(ls -A "${TWG}" 2>/dev/null)" ] ; then
    warn "  ✗ ${TWG/#${HOME}/~} is a non-empty directory — leaving it alone."
    PROBLEMS=$((PROBLEMS + 1))
  elif [ "${CHECK_ONLY}" == 'yes' ] ; then
    warn "  ✗ ${TWG/#${HOME}/~} is an empty directory Docker created for the bind mount."
    warn "    It hides the Jira button and blocks installing twg there."
    PROBLEMS=$((PROBLEMS + 1))
  elif rmdir "${TWG}" 2>/dev/null ; then
    say "  ✓ removed the empty ${TWG/#${HOME}/~} placeholder"
    MADE=$((MADE + 1))
  elif can_sudo && sudo rmdir "${TWG}" ; then
    say "  ✓ removed the root-owned ${TWG/#${HOME}/~} placeholder, so twg can be installed there"
    MADE=$((MADE + 1))
  else
    warn "  ✗ ${TWG/#${HOME}/~} is an empty root-owned directory and cannot be removed as you."
    warn "    Remove it so twg can be installed there:  sudo rmdir ${TWG}"
    PROBLEMS=$((PROBLEMS + 1))
  fi
fi

# ---------------------------------------------- the twg mount, only when it exists --
# Docker recreates the placeholder on EVERY start, so removing it is not enough: while
# twg is not installed, the mount itself has to go. Commenting the line out is how, and
# it is restored the moment twg appears — the same "a script owns this compose value"
# arrangement docker-gid.sh uses for the docker GID.
COMPOSE_TWG="$(cd "$(dirname "${BASH_SOURCE[0]}")/../workspace-app/.ddev" 2>/dev/null && pwd)/docker-compose.twg.yaml"
if [ -f "${COMPOSE_TWG}" ] ; then
  # grep -q, not `grep -c … || echo 0`: grep EXITS 1 when it finds nothing, so the
  # `|| echo 0` appended a second line and the variable became "0\n0" — which is not
  # equal to "0", so every check took the "mount is active" branch and reported a
  # problem on a machine that was already correct.
  if grep -q '^      - "\${HOME}/.local/bin/twg:' "${COMPOSE_TWG}" 2>/dev/null ; then
    twg_line_active='yes'
  else
    twg_line_active='no'
  fi
  if [ -f "${TWG}" ] && [ -x "${TWG}" ] ; then
    if [ "${twg_line_active}" == 'no' ] ; then
      if [ "${CHECK_ONLY}" == 'yes' ] ; then
        warn "  ✗ twg is installed but its mount is commented out — the container cannot see it."
        PROBLEMS=$((PROBLEMS + 1))
      else
        sed -i 's|^      # - "\${HOME}/.local/bin/twg:|      - "${HOME}/.local/bin/twg:|' "${COMPOSE_TWG}" ;
        say "  ✓ twg is installed — its mount re-enabled (ddev restart to apply)" ;
        MADE=$((MADE + 1)) ;
      fi
    else
      say "  ✓ twg is mounted into the dashboard" ;
    fi
  else
    if [ "${twg_line_active}" == 'yes' ] ; then
      if [ "${CHECK_ONLY}" == 'yes' ] ; then
        warn "  ✗ twg is not installed, but its mount is active — Docker will keep recreating"
        warn "    ${TWG/#${HOME}/~} as a root-owned directory on every start."
        PROBLEMS=$((PROBLEMS + 1))
      else
        sed -i 's|^      - "\${HOME}/.local/bin/twg:|      # - "${HOME}/.local/bin/twg:|' "${COMPOSE_TWG}" ;
        say "  ✓ twg is not installed — its mount disabled, so nothing is created for it" ;
        MADE=$((MADE + 1)) ;
      fi
    else
      say "  ✓ twg is not installed, and nothing is mounted for it" ;
    fi
  fi
fi

say ""
if [ "${CHECK_ONLY}" == 'yes' ] ; then
  [ "${PROBLEMS}" -eq 0 ] && { say "Every mounted host path is yours."; exit 0; }
  warn "${PROBLEMS} host path(s) need attention — run without --check for the ones I can fix."
  exit 1
fi
if [ "${PROBLEMS}" -gt 0 ] ; then
  warn "${PROBLEMS} path(s) need root, as printed above. ${MADE} fixed."
  exit 1
fi
say "Every mounted host path is yours.${MADE:+ ${MADE} created.}"
exit 0
