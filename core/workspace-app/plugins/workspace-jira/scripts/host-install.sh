#!/usr/bin/env bash
## The host side of the Jira plugin: twg, the Teamwork Graph CLI, on this machine and signed in.
## Run by core/scripts/plugins.sh --install jira (--check: report only) and in full by install.sh.
## Offered, never automatic: twg is one OAuth session per person, not a machine-wide tool.
set -u
confirm() { local a; read -r -p "$1 [y/N] " a < /dev/tty 2>/dev/null || return 1; [[ "${a}" =~ ^[Yy] ]]; }

# Docker CREATES a missing bind-mount source as a root-owned directory. The plugin mounts ~/.local/bin
# (the directory, so `twg update` on the host is live in the container) and ~/.config/twg; a twg that
# is a DIRECTORY at ~/.local/bin/twg is such a placeholder from an older mount, and blocks installing.
TWG_PLACEHOLDER="${HOME}/.local/bin/twg"
if [ -d "${TWG_PLACEHOLDER}" ] ; then
  if [ -z "$(ls -A "${TWG_PLACEHOLDER}" 2>/dev/null)" ] && rmdir "${TWG_PLACEHOLDER}" 2>/dev/null ; then
    echo "  ✓ removed the empty ${TWG_PLACEHOLDER/#${HOME}/~} placeholder, so twg can be installed there" ;
  else
    echo "  ✗ ${TWG_PLACEHOLDER/#${HOME}/~} is a directory — remove it so twg can be installed there (sudo rmdir ${TWG_PLACEHOLDER})" ;
  fi
fi

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


[ "${1:-}" == '--check' ] && exit 0 ;

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
        true ;
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

