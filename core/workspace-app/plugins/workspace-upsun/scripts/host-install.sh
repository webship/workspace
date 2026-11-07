#!/usr/bin/env bash
## The host side of the Upsun plugin: the upsun CLI on this machine, the dashboard's API token,
## and Upsun's agent toolkit. Run by core/scripts/plugins.sh --install upsun, and by
## core/scripts/install.sh for every installed plugin that ships one. Idempotent: whatever is
## already there is reported, not redone. Offered, never automatic: the CLI holds cloud
## credentials for real environments, so putting it on a machine is a person's decision.
set -u
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)}";
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)";
confirm() { local a; read -r -p "$1 [y/N] " a < /dev/tty 2>/dev/null || return 1; [[ "${a}" =~ ^[Yy] ]]; }
PKG='';
command -v brew > /dev/null 2>&1 && PKG='brew';

# The upsun CLI: a per-person OAuth session, mounted into the dashboard from the host rather
# than installed in the image. ~/.local/bin is where the tarball route puts it and is not always
# on PATH, so `command -v` alone reports it missing on a machine that has it.
UPSUN_BIN='';
for candidate in "$(command -v upsun 2>/dev/null)" "${HOME}/.local/bin/upsun" "${HOME}/.upsun-cli/bin/upsun" ; do
  [ -n "${candidate}" ] && [ -x "${candidate}" ] && { UPSUN_BIN="${candidate}"; break; }
done
if [ -n "${UPSUN_BIN}" ] ; then
  printf '  ✓ %-16s %s\n' "upsun" "${UPSUN_BIN}" ;
else
  printf '  ✗ %-16s %s\n' "upsun" "missing — deploys and the UPSUN menu need it (developer.upsun.com/cli)" ;
fi

# The DASHBOARD's Upsun access is separate from the host CLI's: `upsun login` writes a session
# into the host keyring, which the container cannot reach, so the container needs an API TOKEN in
# core/config/plugin.upsun.settings.yml. Checked by SHAPE, never printed: an Atlassian token in
# that field is refused by Upsun with a message that reads like an expiry.
TOKEN_STATE="$(python3 - "${WORKSPACE_ROOT}/core/config/plugin.upsun.settings.yml" <<'PYEOF' 2>/dev/null || echo unknown
import io, re, sys
try:
    s = io.open(sys.argv[1], encoding='utf-8').read()
except Exception:
    print('unset'); raise SystemExit
m = re.search(r'^cli_token:\s*(\S+)', s, re.M)
t = m.group(1) if m else ''
if not t or t in ('CHANGE_ME', "''", '""'):
    print('unset')
elif t.startswith('ATATT'):
    print('atlassian')
else:
    print('set')
PYEOF
)";
case "${TOKEN_STATE}" in
  set)       printf '  ✓ %-16s %s\n' "upsun token" "set for the dashboard (plugin.upsun.settings.yml)" ;;
  atlassian) printf '  ✗ %-16s %s\n' "upsun token" "cli_token holds an ATLASSIAN token — Upsun refuses it" ;;
  unset)     printf '  ✗ %-16s %s\n' "upsun token" "cli_token not set — every UPSUN action in the dashboard fails" ;;
  *)         ;;
esac

# Upsun's own AI toolkit for coding agents: developer.upsun.com/ai
if bash "${HERE}/upsun-ai.sh" --check --quiet > /dev/null 2>&1 ; then
  printf '  ✓ %-16s %s\n' "upsun AI" "skill + read-only MCP installed" ;
else
  printf '  ✗ %-16s %s\n' "upsun AI" "Upsun's agent skill/MCP not installed (developer.upsun.com/ai)" ;
fi

[ "${1:-}" == '--check' ] && exit 0 ;

if [ -z "${UPSUN_BIN}" ] && confirm "Install the Upsun CLI (deploys, environments — holds cloud credentials)?" ; then
  case "${PKG}" in
    brew) brew install upsun/tap/upsun-cli ;;
    *)
      # Upsun's own installer sets up an apt repository, so it needs root and an interactive
      # password. The release tarball needs neither: one static binary into ~/.local/bin.
      upsun_ver="$(wget -qO- https://api.github.com/repos/upsun/cli/releases/latest 2>/dev/null \
        | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p' | head -1)" ;
      if [ -n "${upsun_ver}" ] ; then
        upsun_tgz="upsun_${upsun_ver}_linux_amd64.tar.gz" ;
        [ "$(uname -m)" == 'aarch64' ] && upsun_tgz="upsun_${upsun_ver}_linux_arm64.tar.gz" ;
        upsun_tmp="$(mktemp -d)" ;
        if wget -qO "${upsun_tmp}/upsun.tgz" "https://github.com/upsun/cli/releases/download/v${upsun_ver}/${upsun_tgz}" \
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
  echo "  The DASHBOARD needs its own credential: put an UPSUN API token in cli_token in" ;
  echo "  core/config/plugin.upsun.settings.yml (Upsun console -> My profile -> API tokens)." ;
fi

# Upsun's AI toolkit — the skill that teaches an agent the Upsun CLI and its config format, and
# the hosted MCP server, registered READ-ONLY (Upsun's own beta default; writes there are
# permanent on live environments).
if confirm "Install Upsun's agent skill and read-only MCP server (developer.upsun.com/ai)?" ; then
  bash "${HERE}/upsun-ai.sh" || true ;
fi
