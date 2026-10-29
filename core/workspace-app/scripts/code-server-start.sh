#!/usr/bin/env bash

################################################################################
## Start the Web IDE (code-server), with defaults that suit this workspace.
################################################################################
## Its own script rather than a long line in .ddev/config.yaml, because it has to
## do one thing before exec-ing: seed the user settings on a machine that has
## none yet.
##
## WORKSPACE TRUST IS OFF. VS Code opens every new folder in Restricted Mode and
## asks "Do you trust the authors of the files in this folder?", and until it is
## answered the terminal refuses to start at all:
##
##     Creating a terminal process requires executing code
##
## That prompt exists for code you downloaded. Here every folder is a project on
## this machine, opened from a dashboard that already offers a real shell at
## /terminal/<session> — so the prompt protects nothing and costs a click plus a
## confused "why can't I open a terminal" on every project. Turning it off is a
## deliberate decision recorded here, not an oversight; see the security note in
## core/workspace-app/README.md.
##
## AGENTS AND SKILLS ARE ALREADY THERE. This runs in the dashboard's container, which
## bind-mounts ~/.claude — so the `claude` CLI in an IDE terminal loads the same 86
## agents, 42 skills and 6 commands a session on the host would, plus the folder's own
## CLAUDE.md and AGENTS.md, because Claude Code reads those from the working directory
## up. Nothing needs installing per project. The only thing missing was DISCOVERABILITY,
## so the seeded settings add "Claude Code" terminal profiles: the terminal dropdown in
## the IDE offers them by name instead of the person having to know to type `claude`.
##
## WATCHERS ARE THE OTHER DRUPAL PROBLEM. One built Drupal project is ~21,000
## directories, 11,800 of them in vendor/, web/core/ and node_modules/ — and the kernel's
## fs.inotify.max_user_watches is 65,536 SHARED ACROSS EVERYTHING on the machine. Open two
## projects and the editor gives up with "Unable to watch for file changes", which means it
## silently stops noticing edits made outside it (a composer install, a git checkout, an
## agent). files.watcherExclude drops those three trees — 55% of the directories per
## project — and needs no root. Raising the sysctl does need root, so install.sh reports it
## rather than this script doing it behind anyone's back.
##
## The PHP file associations matter on Drupal: .module, .install, .theme and .engine are
## PHP, and without this the editor treats them as plain text — no syntax highlighting
## and no outline in exactly the files a Drupal developer opens most.
##
## Values are written in the CURRENT form VS Code expects: it migrates deprecated ones
## and REWRITES the file, so `"extensions.autoUpdate": false` came back as `"off"` on the
## first run. Harmless, but a file that changes itself the moment it is written makes the
## next person wonder which of the two is authoritative.
##
## The settings file is only written when it does NOT exist. It lives in the
## workspace tree (gitignored) so a person's own settings, keybindings and
## extensions survive an image rebuild — and must not be overwritten by a restart.
################################################################################

set -u

: "${WORKSPACE_ROOT:=${HOME}/workspace}"

STATE="${WORKSPACE_ROOT}/.code-server"
USER_DIR="${STATE}/data/User"
SETTINGS="${USER_DIR}/settings.json"

mkdir -p "${USER_DIR}" "${STATE}/extensions"

if [ ! -f "${SETTINGS}" ] ; then
  cat > "${SETTINGS}" <<'JSON'
{
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": "off",
  "workbench.startupEditor": "none",
  "files.autoSave": "off",
  "editor.renderWhitespace": "boundary",
  "editor.rulers": [80, 120],
  "files.trimTrailingWhitespace": true,
  "files.insertFinalNewline": true,
  "files.exclude": {
    "**/.git": true,
    "**/node_modules": true,
    "**/vendor": true
  },
  "search.exclude": {
    "**/node_modules": true,
    "**/vendor": true,
    "**/web/core": true,
    "**/web/modules/contrib": true
  },
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/node_modules/**": true,
    "**/vendor/**": true,
    "**/web/core/**": true,
    "**/web/modules/contrib/**": true,
    "**/web/themes/contrib/**": true,
    "**/web/libraries/**": true,
    "**/graphify-out/**": true,
    "**/.ddev/**": true
  },
  "terminal.integrated.defaultProfile.linux": "bash",
  "terminal.integrated.profiles.linux": {
    "bash": { "path": "bash", "icon": "terminal-bash" },
    "Claude Code": {
      "path": "claude",
      "icon": "sparkle",
      "overrideName": true
    },
    "Claude Code (accept edits)": {
      "path": "claude",
      "args": ["--permission-mode", "acceptEdits"],
      "icon": "sparkle"
    }
  },
  "files.associations": {
    "*.theme": "php",
    "*.module": "php",
    "*.install": "php",
    "*.profile": "php",
    "*.engine": "php",
    "*.inc": "php"
  }
}
JSON
  echo "code-server: seeded default settings at ${SETTINGS}"
fi

################################################################################
## Claude Code IN the editor, but only if it is configured for use.
################################################################################
## The official extension (Anthropic.claude-code) is published on Open VSX, which is
## the registry code-server queries, so it installs with no marketplace switch and no
## .vsix juggling.
##
## GATED on Claude Code actually being usable here, which means two things and not one:
## the `claude` CLI on PATH (the extension drives it) and a credentials file in
## ~/.claude, which the container bind-mounts from the host. Installing it on a machine
## where Claude Code has never been logged in would put a panel in the editor whose only
## behaviour is to ask for a login that belongs on the host — so on that machine the IDE
## keeps the terminal profiles and nothing else, which is the honest state.
##
## Installed ONCE, when missing: the download is a few MB and doing it on every restart
## would add that to every `ddev restart`. Bounded by a timeout and never fatal — an
## editor that will not start because a registry was slow is a worse outcome than an
## editor without one extension.
CLAUDE_EXT='Anthropic.claude-code'

function claude_is_configured() {
  command -v claude > /dev/null 2>&1 || return 1
  # Either shape counts: the credentials file, or a subscription/API key in the env.
  [ -s "${HOME}/.claude/.credentials.json" ] && return 0
  [ -n "${ANTHROPIC_API_KEY:-}" ] && return 0
  return 1
}

function ext_installed() {
  [ -d "${STATE}/extensions" ] || return 1
  ls -d "${STATE}/extensions/"*"${CLAUDE_EXT,,}"* > /dev/null 2>&1
}

if claude_is_configured ; then
  if ext_installed ; then
    echo "code-server: ${CLAUDE_EXT} already installed"
  else
    echo "code-server: Claude Code is configured here — installing ${CLAUDE_EXT}…"
    if timeout 180 code-server \
         --user-data-dir "${STATE}/data" \
         --extensions-dir "${STATE}/extensions" \
         --install-extension "${CLAUDE_EXT}" ; then
      echo "code-server: ${CLAUDE_EXT} installed"
    else
      echo "code-server: could not install ${CLAUDE_EXT} (registry unreachable?) — the" \
           "Claude Code terminal profiles still work. Retry: ddev restart"
    fi
  fi
else
  echo "code-server: Claude Code is not configured on this machine (no ~/.claude/.credentials.json)" \
       "— skipping the editor extension. Log in on the HOST with \`claude\`, then: ddev restart"
fi

# Loopback only: the ide.* vhost in .ddev/nginx_full/nginx-site.conf is the one way
# in, and that is the whole access control. Never bind 0.0.0.0 here — this process
# has a terminal and write access to the entire workspace tree.
exec code-server \
  --bind-addr 127.0.0.1:8443 \
  --auth none \
  --disable-telemetry \
  --disable-update-check \
  --app-name 'Webship Workspace IDE' \
  --user-data-dir "${STATE}/data" \
  --extensions-dir "${STATE}/extensions"
