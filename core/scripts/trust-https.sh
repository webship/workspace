#!/usr/bin/env bash

################################################################################
## Webship Workspace — trust the local https certificates
################################################################################
## Every workspace URL is https, and DDEV signs those certificates with mkcert's
## local CA. Without that CA in a browser's trust store the page is refused with
## ERR_CERT_AUTHORITY_INVALID — which reads as "the dashboard is broken" rather
## than "one command was never run".
##
##   bash core/scripts/trust-https.sh            create and trust the CA
##   bash core/scripts/trust-https.sh --check    report, change nothing
##   bash core/scripts/trust-https.sh --quiet     only speak when something is wrong
##   bash core/scripts/trust-https.sh --restart-browsers   close stale browsers too
##
## Deliberately SELF-CONTAINED, like scripts/update.sh and workspace-app's
## screen-host.sh: plain bash, no workspace bootstrap. It runs on the host, is
## called from install.sh and from the dashboard's own `ddev start` hook, and
## must work before anything else in the workspace does.
##
## Three trust stores, and they are separate:
##
##   system   /usr/local/share/ca-certificates — curl and the CLI tools. Needs root.
##   browser  ~/.pki/nssdb                     — Chrome/Chromium from a package.
##   confined ~/snap/<browser>/…/.pki/nssdb    — snap browsers, one store EACH.
##
## The last one is why this script exists rather than a bare `mkcert -install`:
## mkcert knows about ~/.pki/nssdb and snap chromium, and nothing else. A snap
## Brave, Edge or Vivaldi reads its own confined store, so the CA has to be put
## there by name — the same certificate, installed once per browser.
################################################################################

set -u

CHECK_ONLY='no'
QUIET='no'
RESTART_BROWSERS='no'
while [ $# -gt 0 ]; do
  case "$1" in
    -c|--check) CHECK_ONLY='yes'; shift ;;
    -q|--quiet) QUIET='yes'; shift ;;
    -r|--restart-browsers) RESTART_BROWSERS='yes'; shift ;;
    -h|--help)  sed -n '3,30p' "${BASH_SOURCE[0]}" | sed 's/^## \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

CA_NICKNAME='mkcert development CA'
TRUSTED=0
ADDED=0
PROBLEMS=0
TOUCHED=()

function say()  { [ "${QUIET}" == 'yes' ] || echo "$@" ; }
function warn() { echo "$@" ; }
function have() { command -v "$1" > /dev/null 2>&1 ; }

# ------------------------------------------------------------------ the CA ---

if ! have mkcert ; then
  warn "  ✗ mkcert is not installed — https cannot be trusted."
  warn "    Install it (apt/dnf/brew install mkcert), then re-run this script."
  exit 1
fi

CAROOT="$(mkcert -CAROOT 2>/dev/null)"
CA_FILE="${CAROOT}/rootCA.pem"

if [ ! -f "${CA_FILE}" ] ; then
  if [ "${CHECK_ONLY}" == 'yes' ] ; then
    warn "  ✗ No local CA in ${CAROOT} — every workspace URL would be refused."
    warn "    Fix it: bash core/scripts/trust-https.sh"
    exit 1
  fi
  # The browser store first, and on its own: it needs no root, and it is the one
  # the dashboard is actually read in. The system store is attempted after.
  say "  Creating the local CA…"
  TRUST_STORES=nss mkcert -install > /dev/null 2>&1 || mkcert -install > /dev/null 2>&1 || {
    warn "  ✗ Could not create the local CA. Run 'mkcert -install' and read what it says."
    exit 1
  }
  CREATED_CA='yes'
else
  CREATED_CA='no'
fi

# ------------------------------------------------------- every browser store ---

# An NSS database Chromium-family browsers read. A snap browser has its own,
# confined to its own directory, so each one is listed separately rather than
# assumed to share ~/.pki/nssdb.
function nss_dirs() {
  echo "${HOME}/.pki/nssdb"
  local snap
  for snap in "${HOME}"/snap/*/ ; do
    [ -d "${snap}" ] || continue
    # Only browsers keep an NSS store; skip the rest of the snaps quietly.
    case "$(basename "${snap}")" in
      chromium|brave|opera|vivaldi|microsoft-edge*|chrome*) ;;
      *) continue ;;
    esac
    # current/ is the versioned home a snap actually runs with; common/ persists
    # across revisions. Whichever exists is where that browser will look.
    [ -d "${snap}current" ] && echo "${snap}current/.pki/nssdb"
    [ -d "${snap}common" ]  && echo "${snap}common/.pki/nssdb"
  done
}

# Firefox does not use NSS databases in those locations — it keeps one cert store
# per profile, so each profile is its own install.
function firefox_profiles() {
  local base
  for base in "${HOME}/.mozilla/firefox" "${HOME}/snap/firefox/common/.mozilla/firefox" ; do
    [ -d "${base}" ] || continue
    find "${base}" -maxdepth 1 -name '*.default*' -type d 2>/dev/null
  done
}

function trust_in_db() {
  local db="$1" label="$2"
  if certutil -d "sql:${db}" -L 2>/dev/null | grep -qF "${CA_NICKNAME}" ; then
    say "  ✓ ${label}"
    TRUSTED=$((TRUSTED + 1))
    return 0
  fi
  if [ "${CHECK_ONLY}" == 'yes' ] ; then
    warn "  ✗ ${label} — does not trust the CA"
    PROBLEMS=$((PROBLEMS + 1))
    return 1
  fi
  mkdir -p "${db}" || { warn "  ✗ ${label} — cannot create ${db}"; PROBLEMS=$((PROBLEMS + 1)); return 1; }
  # A database has to exist before a certificate can go into it, and an empty
  # password is what a browser's own store uses.
  [ -f "${db}/cert9.db" ] || certutil -d "sql:${db}" -N --empty-password > /dev/null 2>&1
  if certutil -d "sql:${db}" -A -t 'C,,' -n "${CA_NICKNAME}" -i "${CA_FILE}" > /dev/null 2>&1 ; then
    say "  ✓ ${label} — CA added"
    ADDED=$((ADDED + 1))
    TOUCHED+=("${db}")
    return 0
  fi
  warn "  ✗ ${label} — certutil refused the certificate"
  PROBLEMS=$((PROBLEMS + 1))
  return 1
}

if have certutil ; then
  while read -r db ; do
    [ -n "${db}" ] || continue
    trust_in_db "${db}" "$(echo "${db}" | sed "s|${HOME}|~|")"
  done < <(nss_dirs)
  while read -r prof ; do
    [ -n "${prof}" ] || continue
    trust_in_db "${prof}" "firefox $(basename "${prof}")"
  done < <(firefox_profiles)
elif [ "$(uname -s)" == 'Linux' ] ; then
  warn "  ✗ certutil is missing, so no browser can be told about the CA."
  warn "    Install it: apt install libnss3-tools   (or dnf install nss-tools)"
  PROBLEMS=$((PROBLEMS + 1))
else
  # macOS browsers read the system keychain, which mkcert -install already wrote.
  say "  ✓ system keychain (macOS browsers read it)"
fi

# --------------------------------------------------------------- what to do ---

say ""
if [ "${CHECK_ONLY}" == 'yes' ] ; then
  if [ "${PROBLEMS}" -eq 0 ] ; then
    say "https is trusted (${TRUSTED} store$([ "${TRUSTED}" == 1 ] || echo s))."
    exit 0
  fi
  warn "https is not trusted in ${PROBLEMS} store(s) — fix it: bash core/scripts/trust-https.sh"
  exit 1
fi

if [ "${ADDED}" -gt 0 ] || [ "${CREATED_CA}" == 'yes' ] ; then
  say "Trusted in ${ADDED} new store(s), already trusted in ${TRUSTED}."
  if [ "${CREATED_CA}" == 'yes' ] ; then
    say ""
    say "The CA is new, so certificates issued before it are not signed by it."
    say "Re-issue them by restarting the project: ddev restart"
  fi
else
  say "Already trusted in ${TRUSTED} store(s). Nothing to do."
fi

# A browser reads its trust store ONCE, at startup. One that has been open since
# before the store was written will keep refusing every workspace URL with
# ERR_CERT_AUTHORITY_INVALID while every check here says the CA is trusted — the
# certificate is fine, the browser simply has not looked again.
#
# So compare each running browser against when its store last changed, and say so.
# This is NOT gated by --quiet: it is the one thing the person at the keyboard has
# to do, and the `ddev start` hook is quiet precisely so that this stands out.
function stale_browsers() {
  local newest=0 db mtime
  for db in "${TOUCHED[@]}" "${HOME}/.pki/nssdb" ; do
    [ -f "${db}/cert9.db" ] || continue
    mtime="$(stat -c %Y "${db}/cert9.db" 2>/dev/null || echo 0)"
    [ "${mtime}" -gt "${newest}" ] && newest="${mtime}"
  done
  [ "${newest}" -gt 0 ] || return 0
  local now age
  now="$(date +%s)"
  age=$((now - newest))   # seconds since a trust store last changed

  local pid started name
  # One line per browser: its name, and how to restart it without losing tabs.
  for name in chrome brave chromium firefox msedge vivaldi opera ; do
    while read -r pid started ; do
      [ -n "${pid}" ] || continue
      # etimes is how long the process has run. Longer than the store's age means
      # it started before the store changed, so it never read the CA.
      [ "${started}" -gt "${age}" ] || continue
      echo "${name}"
      break
    done < <(pgrep -x -o "${name}" 2>/dev/null | while read -r p ; do echo "${p} $(ps -o etimes= -p "${p}" 2>/dev/null | tr -d ' ')" ; done)
  done
}

STALE="$(stale_browsers)"
if [ -n "${STALE}" ] ; then
  if [ "${RESTART_BROWSERS}" == 'yes' ] ; then
    for name in ${STALE} ; do
      warn "  Restarting ${name}…"
      pkill -x "${name}" 2>/dev/null || true
    done
    warn "  Restarted: ${STALE//$'\n'/, }. Open them again and the https warning is gone."
  else
    warn ""
    warn "  ⚠ These browsers were started BEFORE the CA reached their trust store, so they"
    warn "    have not read it and will still refuse every workspace URL:"
    for name in ${STALE} ; do
      case "${name}" in
        firefox) warn "      firefox   — quit it and open it again" ;;
        *)       warn "      ${name}$(printf '%*s' $((9 - ${#name})) '')— type ${name}://restart in the address bar (tabs are restored)" ;;
      esac
    done
    warn "    A trust store is read once, at startup: a reload or a cache clear will not do it."
    warn "    Or re-run with --restart-browsers to have this script close them for you."
  fi
fi

# Only the browser stores are handled without root. Say so rather than letting a
# curl failure look like a different problem.
if have curl && ! curl -s -o /dev/null --max-time 5 https://workspace.ddev.site 2>/dev/null ; then
  if curl -s -o /dev/null --max-time 5 --cacert "${CA_FILE}" https://workspace.ddev.site 2>/dev/null ; then
    say ""
    say "Command-line tools do not trust it yet (browsers do). For those, either pass"
    say "  --cacert ${CA_FILE}"
    say "or add the CA to the system store, which needs your password:"
    say "  sudo mkcert -install"
  fi
fi

[ "${PROBLEMS}" -eq 0 ] || exit 1
exit 0
