#!/usr/bin/env bash

################################################################################
## Webship Workspace — tool installer
################################################################################
## Installs (or verifies) everything the Webship Workspace needs on a fresh
## machine: git, gh, curl, wget, jq, rsync, unzip, zip, sed, vim, links, lynx,
##          diffutils, htop, p7zip-full, gcc, g++, make, python3, gawk, screen, Node.js
## (npm + npx, which also powers the skills.sh CLI), Docker, DDEV and
## gitlab-ci-local, Claude Code, mkcert, twg, upsun. Idempotent: whatever is already
## is left alone.
##
## It also trusts the local https certificates, because every workspace URL is
## https and a fresh machine has no CA to verify them with.
##
##   bash core/scripts/install.sh
##
##   --check   report what is present and what is missing, install nothing
##   -y        install everything missing without asking per group
##
## Linux: Debian/Ubuntu (apt) and Fedora (dnf). macOS: Homebrew. Windows: run
## it inside WSL2 (it tells you how when it detects native Windows).
################################################################################

set -u ;

# The version helpers, sourced explicitly. This installer is deliberately self-contained
# plain bash — it runs before anything is set up, so it never sources bootstrap.sh — but
# "what version is this tree" must have ONE answer, and duplicating it here is how the two
# would drift. fun-version.sh has no dependencies of its own for exactly this reason, and a
# missing file is not fatal: the stamp is skipped and everything else still installs.
# shellcheck source=functions/fun-version.sh
[ -f "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/functions/fun-version.sh" ] \
  && source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/functions/fun-version.sh"

CHECK_ONLY='no';
ASSUME_YES='no';
for arg in "$@"; do
  case "${arg}" in
    --check) CHECK_ONLY='yes' ;;
    -y|--yes) ASSUME_YES='yes' ;;
    -h|--help)
      sed -n '3,19p' "$0" 2>/dev/null || true ;
      echo "Usage: install.sh [--check] [-y]" ;
      exit 0 ;;
  esac
done

# ---------------------------------------------------------------- platform ---
OS='';
PKG='';
case "$(uname -s)" in
  Linux)
    if grep -qi microsoft /proc/version 2>/dev/null ; then
      echo "WSL detected — treating it as Linux. Docker Desktop's WSL2 backend also works.";
    fi
    if command -v apt-get > /dev/null 2>&1 ; then PKG='apt';
    elif command -v dnf > /dev/null 2>&1 ; then PKG='dnf';
    else
      echo "No apt or dnf here. Install the tools below with your package manager, then re-run --check.";
    fi
    OS='linux' ;;
  Darwin)
    OS='mac';
    PKG='brew';
    if ! command -v brew > /dev/null 2>&1 ; then
      echo "Homebrew is how everything installs on macOS and it is missing.";
      echo "  Install it first:  https://brew.sh";
      echo "  Then re-run this script.";
      [ "${CHECK_ONLY}" == 'yes' ] || exit 1 ;
    fi ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "Native Windows shell detected. The workspace runs in WSL2:";
    echo "  1. In an admin PowerShell:  wsl --install -d Ubuntu";
    echo "  2. Reboot, open Ubuntu, and re-run this command there.";
    echo "  3. Install Docker Desktop for Windows and enable its WSL2 backend.";
    exit 1 ;;
  *)
    echo "Unrecognised platform '$(uname -s)' — install the tools manually, then re-run --check.";
    exit 1 ;;
esac

SUDO='';
if [ "${OS}" == 'linux' ] && [ "$(id -u)" != '0' ] ; then SUDO='sudo'; fi

# ------------------------------------------------------------------ helpers --
MISSING=();

function have() { command -v "$1" > /dev/null 2>&1 ; }

function report() {
  local tool="$1" how="$2";
  if have "${tool}" ; then
    printf '  ✓ %-16s %s\n' "${tool}" "$(command -v "${tool}")" ;
  else
    printf '  ✗ %-16s missing  (%s)\n' "${tool}" "${how}" ;
    MISSING+=("${tool}") ;
  fi
}

function confirm() {
  [ "${ASSUME_YES}" == 'yes' ] && return 0 ;
  local answer;
  read -r -p "$1 [y/N] " answer ;
  [ "${answer}" == 'y' ] || [ "${answer}" == 'Y' ] ;
}

function pkg_install() {
  case "${PKG}" in
    apt)  ${SUDO} apt-get update -qq && ${SUDO} apt-get install -y "$@" ;;
    dnf)  ${SUDO} dnf install -y "$@" ;;
    brew) brew install "$@" ;;
    *)    echo "  install manually: $*" ; return 1 ;;
  esac
}

function trust_local_https() {
  # One implementation, shared with the dashboard's own `ddev start` hook, so the
  # two can never disagree about which trust stores a browser reads.
  local script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/trust-https.sh";
  if [ ! -f "${script}" ] ; then
    echo "  trust-https.sh is missing beside this script — skipping.";
    return 0 ;
  fi

  # certutil is what writes a browser trust store, and it is a separate package.
  if [ "${OS}" == 'linux' ] && ! have certutil ; then
    case "${PKG}" in
      apt) confirm "Install libnss3-tools (lets mkcert trust the certificate in Chrome, Brave and Firefox)?" && pkg_install libnss3-tools || true ;;
      dnf) confirm "Install nss-tools (lets mkcert trust the certificate in Chrome, Brave and Firefox)?" && pkg_install nss-tools || true ;;
    esac
  fi

  bash "${script}" || true ;
}

# Is the local CA there, and do the browsers know it? Reported in the survey so
# --check answers "will https work on this machine" without changing anything.
function https_trust_state() {
  local script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/trust-https.sh";
  have mkcert || { echo "no mkcert"; return; }
  [ -f "${script}" ] || { echo "trust-https.sh missing"; return; }
  if bash "${script}" --check > /dev/null 2>&1 ; then echo "trusted"; return; fi
  local caroot; caroot="$(mkcert -CAROOT 2>/dev/null)";
  if [ -z "${caroot}" ] || [ ! -f "${caroot}/rootCA.pem" ] ; then echo "no local CA"; return; fi
  echo "a browser here does not trust the CA";
}

# Record which release this tree is. Nothing else did: update.sh wrote .app-version and
# install.sh and sync-tooling.sh wrote nothing, so a freshly installed machine reported
# "Installed: (untracked)" and offered an update to the version it was already on — for
# ever, on every machine that had not been updated by the updater. Across a team that is
# the support question nobody can answer.
#
# The tag comes from the repository, not from a guess: when it cannot be read (no network,
# no gh) the stamp is skipped and the state stays honestly unknown rather than wrong.
if [ "${CHECK_ONLY}" != 'yes' ] ; then
  ws_tag=""
  command -v workspace_latest_tag > /dev/null 2>&1 && ws_tag="$(workspace_latest_tag 2>/dev/null)"
  if [ -n "${ws_tag}" ] ; then
    command -v workspace_version_stamp > /dev/null 2>&1 && workspace_version_stamp "${ws_tag}" && echo "Recorded this tree as ${ws_tag} (core/workspace-app/.app-version)."
  else
    echo "Could not reach GitHub for the release tag, so the version is not recorded." ;
    echo "  It will be set the first time you run core/workspace-app/scripts/update.sh." ;
  fi
fi

function next_steps() {
  local DOCKER_READY step
  # ------------------------------------------------------- does docker actually work --

  # Installing Docker is not the same as being able to use it. On a fresh Ubuntu the
  # installer above adds you to the docker group, and a group is applied at LOGIN — so
  # this shell, and anything started from it, still cannot reach the daemon. Every
  # ddev command then fails with:
  #
  #   Docker error: permission denied while trying to connect to the docker API
  #
  # which is the single most likely way a first install goes wrong, and it looks like a
  # broken tool rather than a session that predates a group. So it is checked, by trying,
  # rather than assumed from a successful install.
  DOCKER_READY='no';
  if have docker && docker info > /dev/null 2>&1 ; then
    DOCKER_READY='yes';
  fi

  echo "Next steps:";
  step=1;
  if [ "${DOCKER_READY}" == 'no' ] && have docker ; then
    if id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker ; then
      echo "  ${step}. Docker is installed but this shell cannot reach it — start it:";
      echo "       sudo systemctl start docker";
    elif getent group docker 2>/dev/null | grep -q "\b$(id -un)\b" ; then
      echo "  ${step}. LOG OUT AND BACK IN. You are in the docker group, but a group only";
      echo "     applies at login, so this shell still cannot reach Docker — and every";
      echo "     ddev command would fail with a permission error that looks like a bug.";
    else
      echo "  ${step}. Add yourself to the docker group, then log out and back in:";
      echo "       sudo usermod -aG docker $(id -un)";
    fi
    step=$((step+1));
  fi
  echo "  ${step}. gh auth login";
  step=$((step+1));
  echo "  ${step}. cd core/workspace-app && ddev start";
  step=$((step+1));
  echo "  ${step}. Open https://workspace.ddev.site";
  if [ "${DOCKER_READY}" == 'yes' ] ; then
    echo "";
    echo "Docker answers in this shell, so step $((step-1)) will work now.";
  fi
}

# ------------------------------------------------------------------- survey --
echo "";
echo "Webship Workspace tools on this ${OS} machine:";
echo "";
report git     "package manager";
report curl    "package manager";
report wget    "package manager";
report jq      "package manager";
report rsync   "package manager";
report unzip   "package manager";
report python3 "package manager";
report screen  "package manager";
report awk     "gawk via package manager";
report vim     "package manager";
report links   "package manager";
report lynx    "package manager";
report diff    "diffutils via package manager";
report htop    "package manager";
report 7z      "p7zip-full via package manager";
report zip     "package manager";
report sed     "package manager";
report gcc     "package manager";
report g++     "package manager";
report make    "package manager";
report python  "python-is-python3 via package manager";
report gh      "GitHub CLI — cli.github.com";
report node    "Node.js LTS — nodejs.org";
report npm     "ships with Node.js";
report npx     "ships with Node.js";
report docker  "get.docker.com / Docker Desktop";
report ddev    "ddev.com/install.sh";
report mkcert  "package manager — signs the https certificates DDEV serves";
report gitlab-ci-local "npm -g gitlab-ci-local";
report claude  "npm -g @anthropic-ai/claude-code";
echo "";
if have npx ; then
  echo "  ✓ skills.sh CLI    runs through npx (npx skills …), nothing to install";
else
  echo "  ✗ skills.sh CLI    needs npx (comes with Node.js)";
fi
echo "";
# twg installs into ~/.local/bin, which is not always on PATH, so `command -v` alone
# would report it missing on a machine that has it. The dashboard looks for the binary
# at a path for the same reason.
TWG_BIN='';
for candidate in "$(command -v twg 2>/dev/null)" "${HOME}/.local/bin/twg" /usr/local/bin/twg ; do
  [ -n "${candidate}" ] && [ -f "${candidate}" ] && [ -x "${candidate}" ] && { TWG_BIN="${candidate}"; break; }
done
if [ -n "${TWG_BIN}" ] ; then
  # Installed is not the same as signed in, and the difference is the whole symptom:
  # the dashboard's Jira gate is a BINARY check, so the button appears the moment the
  # file exists and every Jira action then fails with `AUTH_REQUIRED`. Reporting only
  # the binary sends you looking for a broken button instead of an unfinished login.
  # Read from the CLI's own state file rather than by calling the API: a survey must
  # not make a network round trip, and must never touch the token.
  # Detect the ERROR shape, not a success marker. twg prints `{"projects": [...]}` on
  # success with NO "ok" field at all — only failures carry `"ok": false` and a code — so
  # the first version of this check (grep for `"ok": true`) reported EVERY signed-in CLI as
  # signed out. Matching the failure is also robust to the success shape changing.
  if ! "${TWG_BIN}" jira space list --limit 1 2>&1 | grep -qE '"ok": *false|AUTH_REQUIRED|authentication required' ; then
    printf '  ✓ %-16s %s\n' "twg" "${TWG_BIN} — signed in" ;
  else
    printf '  ✗ %-16s %s\n' "twg" "${TWG_BIN} — NOT signed in: run  ${TWG_BIN/#${HOME}/~} login --force" ;
    printf '  %-18s %s\n' "" "The Jira button appears anyway (the gate is a binary check), and every" ;
    printf '  %-18s %s\n' "" "Jira action answers 'authentication required' until you have signed in." ;
  fi
else
  printf '  ✗ %-16s %s\n' "twg" "missing — the Jira button stays hidden (teamworkgraph.com/cli)" ;
fi

# The hub domain, for the URLs this survey prints. Read from settings.yml when it is
# there, so a machine with a custom hub_domain is told its own address rather than the
# default one.
function hub_domain_or_default() {
  local cfg="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/config/settings.yml"
  local d=''
  # One sed: take the value, drop surrounding quotes and any trailing spaces. Nesting
  # quote-stripping inside a command substitution is how the first version of this line
  # became unparseable — keep it in the sed script, not in the shell.
  [ -f "${cfg}" ] && d="$(sed -n 's/^hub_domain:[[:space:]]*//; t v; b; :v s/^["\x27]//; s/["\x27][[:space:]]*$//; s/[[:space:]]*$//; p' "${cfg}" | head -1)"
  echo "${d:-workspace.ddev.site}"
}

# EXPOSURE. The single most consequential line in this survey, and the reason it is here at
# all: this workspace has NO AUTHENTICATION. It serves a dashboard that runs shell commands,
# a browser terminal at /terminal/<session>, and a Web IDE with write access to the whole
# tree and a terminal of its own — in a container holding the Docker socket and the DDEV
# registry.
#
# That is defensible, and only because everything binds to LOOPBACK: DDEV's router is
# 127.0.0.1 by default and the machine answers nothing on its LAN address. It stops being
# defensible the moment either of two settings changes, and both are things a person changes
# for a good-looking reason:
#
#   router_bind_all_interfaces: true   DDEV documents it for Let's Encrypt and for reaching
#                                      a project from a phone on the same network.
#   hub_domain: <a public domain>      the README says the same system runs as a remote hub.
#
# Neither warns you today. So this does, loudly, because the failure mode is not an error
# message — it is a shell on someone's machine, available to whoever can reach the port.
ws_bind_all="$(sed -n 's/^router_bind_all_interfaces:[[:space:]]*//p' "${HOME}/.ddev/global_config.yaml" 2>/dev/null | head -1 | tr -d '[:space:]')"
ws_hub="$(hub_domain_or_default)"
ws_exposed='no'
case "${ws_bind_all}" in true|yes) ws_exposed='bind' ;; esac
case "${ws_hub}" in *.ddev.site|localhost|127.0.0.1) ;; *) ws_exposed="${ws_exposed}+domain" ;; esac

if [ "${ws_exposed}" == 'no' ] ; then
  printf '  ✓ %-16s %s\n' "exposure" "loopback only (router binds 127.0.0.1, hub is ${ws_hub})"
else
  printf '  ✗ %-16s %s\n' "exposure" "THIS MACHINE MAY BE REACHABLE FROM THE NETWORK"
  case "${ws_exposed}" in
    *bind*)   printf '  %-18s %s\n' "" "router_bind_all_interfaces is ${ws_bind_all} — the router listens on every interface." ;;
  esac
  case "${ws_exposed}" in
    *domain*) printf '  %-18s %s\n' "" "hub_domain is ${ws_hub}, which is not a local address." ;;
  esac
  printf '  %-18s %s\n' "" "There is NO login on the dashboard, and it offers a terminal, a Web IDE with"
  printf '  %-18s %s\n' "" "write access to ${WORKSPACE_ROOT_GUESS:-~/workspace}, and the Docker socket. Anyone who can reach"
  printf '  %-18s %s\n' "" "the port has all of it. Put real authentication in front of it, or bind it back:"
  printf '  %-18s %s\n' "" "  ddev config global --router-bind-all-interfaces=false"
fi

# The ddev router-lock shim. The dashboard's container gets it from its image; on the
# HOST it is a root-owned file, so it is reported here and offered below rather than
# installed silently — a wrapper in front of ddev is not something to appear unannounced.
SHIM_SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ddev-shim/ddev"
SHIM_DEST='/usr/local/sbin/ddev'
if [ ! -x "$(command -v ddev 2>/dev/null)" ] ; then
  printf '  – %-16s %s\n' "ddev lock" "skipped: ddev is not installed on this host"
elif [ "$(command -v ddev)" == "${SHIM_DEST}" ] ; then
  if cmp -s "${SHIM_SRC}" "${SHIM_DEST}" 2>/dev/null ; then
    printf '  ✓ %-16s %s\n' "ddev lock" "the router-lock wrapper is first on PATH"
  else
    printf '  ✗ %-16s %s\n' "ddev lock" "${SHIM_DEST} is an OLD copy of the wrapper — re-run this installer"
  fi
else
  printf '  ✗ %-16s %s\n' "ddev lock" "not installed on this host — concurrent ddev start/stop can destroy"
  printf '  %-18s %s\n' "" "the shared ddev-router and take every workspace URL down. The dashboard"
  printf '  %-18s %s\n' "" "is protected; a terminal or a cmd-*.sh script on this host is not."
fi

# inotify watches, which the Web IDE needs and Drupal exhausts. ONE built Drupal project
# is ~21,000 directories; the kernel default is 65,536 watches SHARED ACROSS THE WHOLE
# MACHINE, so two open projects and the editor stops noticing file changes — silently,
# except for one toast. The IDE's own settings already exclude vendor/, web/core/ and
# node_modules/ (55% of them), and this is the other half. Reported, never applied: it is
# a sysctl, it needs root, and a setup script changing kernel limits unasked is not on.
IN_WATCHES="$(cat /proc/sys/fs/inotify/max_user_watches 2>/dev/null || echo 0)"
if [ "${IN_WATCHES}" -ge 262144 ] ; then
  printf '  ✓ %-16s %s\n' "inotify watches" "${IN_WATCHES}"
else
  printf '  ✗ %-16s %s\n' "inotify watches" "${IN_WATCHES} — too low for the Web IDE on Drupal projects"
  printf '  %-18s %s\n' "" "The editor will report \"Unable to watch for file changes\" and stop noticing"
  printf '  %-18s %s\n' "" "edits made outside it. Raise it (needs root, survives reboot):"
  printf '  %-18s %s\n' "" "  echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-inotify.conf"
  printf '  %-18s %s\n' "" "  sudo sysctl --system"
fi

# The Web IDE (code-server) — VS Code in the browser, which the dashboard's project rows
# and document folders link to. It is NOT installed on the host: it lives in the
# dashboard's own image and runs as one of its web_extra_daemons, so what there is to
# check here is whether that image carries it and whether the daemon is up. Both are
# answered from the container, which is also the honest place to answer them from.
IDE_STATE='unknown'
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^ddev-workspace-web$' ; then
  if docker exec ddev-workspace-web bash -lc 'command -v code-server >/dev/null' 2>/dev/null ; then
    ide_ver="$(docker exec ddev-workspace-web bash -lc 'code-server --version 2>/dev/null | head -1' 2>/dev/null | awk '{print $1}')"
    if docker exec ddev-workspace-web bash -lc 'curl -sf -o /dev/null --max-time 5 http://127.0.0.1:8443/' 2>/dev/null ; then
      printf '  ✓ %-16s %s\n' "web IDE" "code-server ${ide_ver} — https://ide.$(hub_domain_or_default)/"
      IDE_STATE='up'
    else
      printf '  ✗ %-16s %s\n' "web IDE" "code-server ${ide_ver} is in the image but not answering — ddev restart"
      IDE_STATE='down'
    fi
  else
    printf '  ✗ %-16s %s\n' "web IDE" "not in the dashboard image — rebuild it: ddev restart (it is baked in by .ddev/web-build)"
    IDE_STATE='missing'
  fi
else
  printf '  – %-16s %s\n' "web IDE" "skipped: the dashboard container is not running"
fi

# The upsun CLI, same shape as twg: a per-person OAuth session, mounted into the
# dashboard from the host rather than installed in the image.
# ~/.local/bin is where the tarball route puts it and is not always on PATH, so
# `command -v` alone reports it missing on a machine that has it.
UPSUN_BIN='';
for candidate in "$(command -v upsun 2>/dev/null)" "${HOME}/.local/bin/upsun" "${HOME}/.upsun-cli/bin/upsun" ; do
  [ -n "${candidate}" ] && [ -x "${candidate}" ] && { UPSUN_BIN="${candidate}"; break; }
done
if [ -n "${UPSUN_BIN}" ] ; then
  printf '  ✓ %-16s %s\n' "upsun" "${UPSUN_BIN}" ;
else
  printf '  ✗ %-16s %s\n' "upsun" "missing — deploys and the UPSUN menu need it (developer.upsun.com/cli)" ;
fi

# The DASHBOARD's Upsun access is a separate thing from the host CLI's. `upsun login`
# writes a session into the host keyring, and the dashboard's container cannot reach a
# keyring — so the container needs an API TOKEN in upsun.cli_token. Without it every
# UPSUN action in the dashboard fails. Checked by SHAPE, never printed: an Atlassian
# token in that field is refused by Upsun with a message that reads like an expiry.
UPSUN_TOKEN_STATE="$(python3 - <<'PYEOF' 2>/dev/null || echo unknown
import io, re
try:
    s = io.open('core/config/settings.yml', encoding='utf-8').read()
except Exception:
    print('unknown'); raise SystemExit
m = re.search(r'^upsun:\s*$.*?^\s+cli_token:\s*(\S+)', s, re.M | re.S)
t = m.group(1) if m else ''
if not t or t in ('CHANGE_ME', "''", '""'):
    print('unset')
elif t.startswith('ATATT'):
    print('atlassian')
else:
    print('set')
PYEOF
)";
case "${UPSUN_TOKEN_STATE}" in
  set)       printf '  ✓ %-16s %s\n' "upsun token" "set for the dashboard (upsun.cli_token)" ;;
  atlassian) printf '  ✗ %-16s %s\n' "upsun token" "upsun.cli_token holds an ATLASSIAN token — Upsun refuses it" ;;
  unset)     printf '  ✗ %-16s %s\n' "upsun token" "upsun.cli_token not set — every UPSUN action in the dashboard fails" ;;
  *)         ;;
esac

# Upsun's own AI toolkit for coding agents: developer.upsun.com/ai
if bash "$(dirname "${BASH_SOURCE[0]}")/upsun-ai.sh" --check --quiet > /dev/null 2>&1 ; then
  printf '  ✓ %-16s %s\n' "upsun AI" "skill + read-only MCP installed" ;
else
  printf '  ✗ %-16s %s\n' "upsun AI" "Upsun's agent skill/MCP not installed (developer.upsun.com/ai)" ;
fi

# Docker CREATES a missing bind-mount source, as a root-owned directory. Every optional
# tool the dashboard shares from the host is such a source, so this is checked before
# anything installs into one of them.
if bash "$(dirname "${BASH_SOURCE[0]}")/host-mounts.sh" --check --quiet > /dev/null 2>&1 ; then
  printf '  ✓ %-16s %s\n' "mounted paths" "the host paths the dashboard shares are yours" ;
else
  printf '  ✗ %-16s %s\n' "mounted paths" "a path Docker created is root-owned — see below" ;
fi

# The dashboard runs ddev inside its own container against the host's docker.sock, so
# a mismatched docker GID is as much a prerequisite as the tools above — and its symptom
# (every project reads as Stopped) looks like anything but a permissions problem.
DOCKER_GID_STATE='aligned';
if [ -f "$(dirname "${BASH_SOURCE[0]}")/docker-gid.sh" ] ; then
  bash "$(dirname "${BASH_SOURCE[0]}")/docker-gid.sh" --check --quiet > /dev/null 2>&1 || DOCKER_GID_STATE='mismatched';
fi
if [ "${DOCKER_GID_STATE}" == 'aligned' ] ; then
  printf '  ✓ %-16s %s\n' "dashboard docker" "shares this host's docker group" ;
else
  printf '  ✗ %-16s %s\n' "dashboard docker" "wrong docker GID — every project would read as Stopped" ;
fi

# Every workspace URL is https, so this is as much a prerequisite as the tools above.
HTTPS_STATE="$(https_trust_state)";
if [ "${HTTPS_STATE}" == 'trusted' ] ; then
  printf '  ✓ %-16s %s\n' "https trust" "${HTTPS_STATE}" ;
else
  printf '  ✗ %-16s %s\n' "https trust" "${HTTPS_STATE} — every workspace URL would be refused by the browser" ;
fi
echo "";

if [ "${#MISSING[@]}" -eq 0 ] ; then
  echo "Every tool is here.";
  # The tools being present says nothing about the certificates: this machine is the
  # common case — a complete toolchain and no local CA, so https is refused.
  if [ "${HTTPS_STATE}" == 'trusted' ] && [ "${DOCKER_GID_STATE}" == 'aligned' ] ; then
    echo "";
    next_steps ;
    exit 0 ;
  fi
  if [ "${CHECK_ONLY}" == 'yes' ] ; then
    echo "Re-run without --check to fix what is marked ✗ above.";
    exit 1 ;
  fi
  echo "";
  echo "Trusted https for the workspace URLs:";
  trust_local_https ;
  echo "";
  echo "The dashboard's Docker access:";
  bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/docker-gid.sh" || true ;
  echo "";
  next_steps ;
  exit 0 ;
fi
if [ "${CHECK_ONLY}" == 'yes' ] ; then
  echo "Missing: ${MISSING[*]}   (re-run without --check to install)";
  exit 1 ;
fi

# ------------------------------------------------------------------ install --
function missing() {
  local tool;
  for tool in "${MISSING[@]}"; do [ "${tool}" == "$1" ] && return 0 ; done
  return 1 ;
}

base_pkgs=();
for tool in git curl wget jq rsync unzip zip sed vim links lynx htop gcc g++ make python3 screen ; do
  missing "${tool}" && base_pkgs+=("${tool}") ;
done
# These carry a package name that is not the command name.
missing awk    && base_pkgs+=(gawk) ;
missing diff   && base_pkgs+=(diffutils) ;
missing 7z     && base_pkgs+=(p7zip-full) ;
missing python && base_pkgs+=(python-is-python3) ;
if [ "${#base_pkgs[@]}" -gt 0 ] && confirm "Install base tools (${base_pkgs[*]})?" ; then
  pkg_install "${base_pkgs[@]}" ;
fi

if missing gh && confirm "Install the GitHub CLI (gh)?" ; then
  case "${PKG}" in
    apt)
      # Debian/Ubuntu ship no gh package — this is the official keyring + repo.
      ${SUDO} mkdir -p /etc/apt/keyrings ;
      wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | ${SUDO} tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null ;
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | ${SUDO} tee /etc/apt/sources.list.d/github-cli.list > /dev/null ;
      ${SUDO} apt-get update -qq && ${SUDO} apt-get install -y gh ;;
    dnf)  ${SUDO} dnf install -y gh ;;
    brew) brew install gh ;;
  esac
fi

if missing node && confirm "Install Node.js LTS (brings npm, npx and the skills.sh CLI)?" ; then
  case "${PKG}" in
    apt)
      wget -qO- https://deb.nodesource.com/setup_lts.x | ${SUDO} bash - ;
      ${SUDO} apt-get install -y nodejs ;;
    dnf)  ${SUDO} dnf install -y nodejs npm ;;
    brew) brew install node ;;
  esac
fi

if missing docker && confirm "Install Docker?" ; then
  if [ "${OS}" == 'mac' ] ; then
    echo "  On macOS install Docker Desktop (or OrbStack):";
    echo "    brew install --cask docker      # or: brew install --cask orbstack";
    echo "  Start it once so the docker CLI works, then re-run --check.";
  else
    # Docker's official convenience script; adds the current user to the docker group after.
    wget -qO- https://get.docker.com | ${SUDO} sh ;
    if [ -n "${SUDO}" ] ; then
      ${SUDO} usermod -aG docker "$(id -un)" \
        && echo "  Added $(id -un) to the docker group — log out and back in for it to apply." ;
    fi
  fi
fi

if missing ddev && confirm "Install DDEV?" ; then
  # DDEV's official package repos — unlike ddev.com/install.sh these also work as root
  # (containers, CI) and get updated by the package manager afterwards.
  case "${PKG}" in
    apt)
      have gpg || ${SUDO} apt-get install -y gnupg ;
      ${SUDO} mkdir -p /etc/apt/keyrings ;
      wget -qO- https://pkg.ddev.com/apt/gpg.key | gpg --dearmor \
        | ${SUDO} tee /etc/apt/keyrings/ddev.gpg > /dev/null ;
      echo "deb [signed-by=/etc/apt/keyrings/ddev.gpg] https://pkg.ddev.com/apt/ * *" \
        | ${SUDO} tee /etc/apt/sources.list.d/ddev.list > /dev/null ;
      ${SUDO} apt-get update -qq && ${SUDO} apt-get install -y ddev ;;
    dnf)
      echo '[ddev]
name=ddev
baseurl=https://pkg.ddev.com/yum/
enabled=1
gpgcheck=0' | ${SUDO} tee /etc/yum.repos.d/ddev.repo > /dev/null ;
      ${SUDO} dnf install -y ddev ;;
    brew) brew install ddev/ddev/ddev ;;
  esac
fi

if missing gitlab-ci-local && have npm && confirm "Install gitlab-ci-local (runs .gitlab-ci.yml pipelines locally)?" ; then
  npm install -g gitlab-ci-local ;
fi

# mkcert signs the certificate every workspace URL is served with. DDEV installs it
# on some platforms and not others, so ask for it by name.
if missing mkcert && confirm "Install mkcert (trusted https for every workspace URL)?" ; then
  pkg_install mkcert || true ;
fi

# Before installing anything into ~/.local/bin: if Docker created it as root for a bind
# mount, the twg installer below cannot write there. This makes those paths yours first.
echo "";
echo "The host paths the dashboard shares:";
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/host-mounts.sh" --sudo || true ;

# twg — the Teamwork Graph CLI, which is how the dashboard and the Jira agents read and
# write Jira. https://teamworkgraph.com/cli · https://developer.atlassian.com/cloud/twg-cli/
# It installs into ~/.local/bin and authenticates in the browser, so it is offered rather
# than assumed: it is one OAuth session per person, not a machine-wide tool.
# Its last step is a consent prompt that needs a controlling terminal — so this works
# when a person runs the installer and fails under -y in a pipe, where it says to pass
# --agree. Recording that consent is a person's to give, so it is not passed here.
if [ -z "${TWG_BIN}" ] && confirm "Install twg, the Teamwork Graph CLI (Jira from the terminal)?" ; then
  # NOT `curl … | bash`, which is what Atlassian documents and which installs NOTHING
  # here. Its last step records consent, that prompt needs a controlling terminal, and
  # on failure the installer DELETES the binary it just downloaded:
  #
  #   Interactive auth prompting is unavailable … without a controlling terminal.
  #   Pass --agree or --yes to record consent without an interactive prompt.
  #   Command failed: ~/.local/bin/twg consent --source direct-public-installer
  #
  # `--yes` alone does not help: the script forwards it to consent only when --yes,
  # --skip-login AND --skip-skills are all set. And passing --agree from here would
  # record a person's agreement to Atlassian's terms on their behalf, which is not
  # this script's to give — so the release binary is fetched directly and consent is
  # left to the first `twg login`, where a person answers it.
  #
  # The download is CHECKSUM-VERIFIED against the SHA256SUMS file published beside it.
  # Fetching a 100MB binary over https and running it unverified would be worse than
  # the pipe this replaces.
  twg_arch='x64'; [ "$(uname -m)" == 'aarch64' ] && twg_arch='arm64' ;
  twg_ver="$(curl -fsSL --retry 2 https://teamwork-graph.atlassian.com/cli/install 2>/dev/null \
             | sed -n 's/^DEFAULT_VERSION="\([^"]*\)".*/\1/p' | head -1)" ;
  if [ -z "${twg_ver}" ] ; then
    echo "  ✗ could not read the current twg version from teamwork-graph.atlassian.com — skipped." ;
  else
    twg_asset="twg-linux-${twg_arch}-v${twg_ver}" ;
    twg_tmp="$(mktemp -d)" ;
    if curl -fsSL --retry 2 -o "${twg_tmp}/twg" "https://teamwork-graph.atlassian.com/cli/${twg_asset}" \
       && curl -fsSL --retry 2 -o "${twg_tmp}/sums" "https://teamwork-graph.atlassian.com/cli/SHA256SUMS-v${twg_ver}" ; then
      twg_want="$(awk -v a="${twg_asset}" '$2 == a { print $1 }' "${twg_tmp}/sums")" ;
      twg_got="$(sha256sum "${twg_tmp}/twg" | awk '{print $1}')" ;
      if [ -n "${twg_want}" ] && [ "${twg_want}" == "${twg_got}" ] ; then
        mkdir -p "${HOME}/.local/bin" ;
        install -m 0755 "${twg_tmp}/twg" "${HOME}/.local/bin/twg" ;
        TWG_BIN="${HOME}/.local/bin/twg" ;
        echo "  ✓ twg ${twg_ver} installed to ~/.local/bin/twg (sha256 verified)" ;
        # The mount is disabled while twg is absent, so it has to be turned back on now
        # — Docker recreates the placeholder on every start otherwise. See host-mounts.sh.
        bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/host-mounts.sh" --quiet || true ;
        echo "" ;
        echo "  One step is yours, because it needs a browser:" ;
        echo "      ~/.local/bin/twg login --force" ;
        echo "  It prints a URL and a code (OAuth DEVICE authorization), so the browser does" ;
        echo "  not have to be on this machine — open the URL anywhere, enter the code, and" ;
        echo "  the CLI finishes on its own. Check it with:  ~/.local/bin/twg jira space list --limit 1" ;
        echo "  The dashboard shares ~/.config/twg, so it sees the session with no restart." ;
        case ":${PATH}:" in
          *":${HOME}/.local/bin:"*) ;;
          *) echo "  ~/.local/bin is not on your PATH — add it, or call twg by its full path." ;;
        esac
      else
        echo "  ✗ twg download did not match the published sha256 — NOT installed." ;
        echo "    expected ${twg_want:-<no entry for ${twg_asset}>}" ;
        echo "    got      ${twg_got}" ;
      fi
    else
      echo "  ✗ could not download ${twg_asset} — check network access." ;
    fi
    rm -rf "${twg_tmp}" ;
  fi
fi

# The ddev router-lock wrapper on this host. Offered, because it puts a script in front of
# a binary people rely on: that is a thing to say out loud, not to do quietly. Needs root
# for /usr/local/sbin, which precedes /usr/local/bin and /usr/bin on a default PATH.
if [ -n "$(command -v ddev 2>/dev/null)" ] && [ "$(command -v ddev)" != "${SHIM_DEST}" ] \
   && confirm "Serialise ddev start/stop on this host (a wrapper that holds a lock — stops concurrent starts destroying the router)?" ; then
  if sudo install -m 0755 "${SHIM_SRC}" "${SHIM_DEST}" ; then
    # Prove it before claiming it: the wrapper has to find the real binary and pass a
    # read-only verb straight through, or every ddev call on this machine is now broken.
    if "${SHIM_DEST}" --version > /dev/null 2>&1 ; then
      echo "  ✓ installed at ${SHIM_DEST} — ddev --version still answers through it" ;
      echo "    Router verbs (start, stop, restart, poweroff, delete) now queue instead of racing." ;
      echo "    Everything else — drush, composer, list, describe — passes straight through." ;
      echo "    Remove it any time with:  sudo rm ${SHIM_DEST}" ;
    else
      echo "  ✗ the wrapper does not run — REMOVING it so ddev keeps working:" ;
      sudo rm -f "${SHIM_DEST}" ;
      echo "    sudo rm ${SHIM_DEST}  (done)" ;
    fi
  else
    echo "  ✗ could not write ${SHIM_DEST} — ddev is unchanged." ;
  fi
fi

# upsun — the Upsun CLI, which cmd-tools-upsun.sh and the dashboard's UPSUN menu drive.
# https://developer.upsun.com/cli · https://docs.upsun.com/administration/cli.html
# Offered, never automatic: it holds cloud credentials for real environments, so the
# decision to put it on a machine is a person's.
if [ -z "${UPSUN_BIN}" ] && confirm "Install the Upsun CLI (deploys, environments — holds cloud credentials)?" ; then
  case "${PKG}" in
    brew) brew install upsun/tap/upsun-cli ;;
    *)
      # Upsun's own installer sets up an apt repository, so it needs root and an
      # interactive password — it fails outright in a pipe with "sudo: A terminal is
      # required to authenticate". The release tarball needs neither: one static binary
      # into ~/.local/bin, which is where twg goes too. Falls back to the official
      # installer if GitHub cannot be reached.
      upsun_ver="$(wget -qO- https://api.github.com/repos/upsun/cli/releases/latest 2>/dev/null \
        | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)" ;
      if [ -n "${upsun_ver}" ] ; then
        upsun_tgz="upsun_${upsun_ver}_linux_amd64.tar.gz" ;
        [ "$(uname -m)" == 'aarch64' ] && upsun_tgz="upsun_${upsun_ver}_linux_arm64.tar.gz" ;
        upsun_tmp="$(mktemp -d)" ;
        if wget -qO "${upsun_tmp}/upsun.tgz" \
             "https://github.com/upsun/cli/releases/download/v${upsun_ver}/${upsun_tgz}" \
           && tar -xzf "${upsun_tmp}/upsun.tgz" -C "${upsun_tmp}" upsun ; then
          mkdir -p "${HOME}/.local/bin" ;
          install -m 0755 "${upsun_tmp}/upsun" "${HOME}/.local/bin/upsun" ;
          echo "  Installed upsun ${upsun_ver} to ~/.local/bin/upsun (no root needed)." ;
        else
          echo "  Could not fetch the release tarball — falling back to Upsun's installer (needs sudo)." ;
          curl -fsSL https://raw.githubusercontent.com/upsun/cli/main/installer.sh | bash ;
        fi
        rm -rf "${upsun_tmp}" ;
      else
        curl -fsSL https://raw.githubusercontent.com/upsun/cli/main/installer.sh | bash ;
      fi ;;
  esac
  echo "  Sign in with:  upsun login   (it opens your browser, then writes SSH certificates)" ;
  echo "  The DASHBOARD needs its own credential: `upsun login` writes a host keyring" ;
  echo "  session, and its container cannot reach a keyring. Put an UPSUN API token in" ;
  echo "  upsun.cli_token in core/config/settings.yml (Upsun console -> My profile ->" ;
  echo "  API tokens). Not an Atlassian token — Upsun refuses those with a message that" ;
  echo "  reads like an expiry." ;
fi

# Upsun's AI toolkit — the skill that teaches an agent the Upsun CLI and its config
# format, and the hosted MCP server. https://developer.upsun.com/ai
# Registered READ-ONLY: that is Upsun's own beta default, and writes there are
# permanent on live environments.
if confirm "Install Upsun's agent skill and read-only MCP server (developer.upsun.com/ai)?" ; then
  bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/upsun-ai.sh" || true ;
fi

# Claude Code — the CLI the dashboard's agents, the Screens page and the Jira
# actions all run (code.claude.com/docs/en/quickstart). The same package the
# workspace's own container installs, so host and container agree.
if missing claude && have npm && confirm "Install Claude Code (the AI CLI the workspace agents run)?" ; then
  npm install -g @anthropic-ai/claude-code ;
  echo "  Run 'claude' once to sign in." ;
fi

# -------------------------------------------------------------- trusted https --
# Every workspace URL is https, and DDEV signs those certificates with mkcert's local
# CA. A fresh machine has no CA at all, so the browser refuses every page with
# ERR_CERT_AUTHORITY_INVALID — which reads as "the dashboard is broken" rather than
# "one command was never run". So it belongs in the install.
#
# Two trust stores, and they are separate:
#   system  /usr/local/share/ca-certificates — curl and the CLI tools. Needs root.
#   browser ~/.pki/nssdb (NSS)               — Chrome and Firefox. No root needed.
#
# mkcert skips the browser store SILENTLY when that database does not exist, which is
# the failure worth preventing here: the CA gets created, the system store gets it, and
# the browser still refuses the page. So the database is created first.

echo "";
echo "Trusted https for the workspace URLs:";
trust_local_https ;

# The dashboard runs ddev inside its own container against the host's docker.sock,
# which only works if it shares the host's docker GID. Wrong, and every project
# reads as Stopped forever while running perfectly well.
echo "";
echo "The dashboard's Docker access:";
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/docker-gid.sh" || true ;

# ------------------------------------------------------------------- recheck --
echo "";
echo "Done. Re-checking:";
MISSING=();
for tool in git curl wget jq rsync unzip zip sed vim links lynx diff htop 7z gcc g++ make python3 python awk screen gh node npm npx docker ddev mkcert gitlab-ci-local claude ; do
  report "${tool}" "see above" ;
done
echo "";
if [ "${#MISSING[@]}" -gt 0 ] ; then
  echo "Still missing: ${MISSING[*]} — see the notes above.";
  echo "";
fi

next_steps ;
