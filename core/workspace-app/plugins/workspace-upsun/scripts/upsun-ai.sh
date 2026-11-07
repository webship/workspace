#!/usr/bin/env bash

################################################################################
## Webship Workspace — install Upsun's own AI toolkit for coding agents
################################################################################
## Upsun publishes a skill and an MCP server for coding agents:
##
##   https://developer.upsun.com/ai
##   https://github.com/upsun/ai        the toolkit: plugin + skill + MCP
##   https://github.com/upsun/skills    the skill on its own
##
## The skill teaches an agent the Upsun CLI — 130+ commands across 30 namespaces,
## plus per-framework config recipes including Drupal and PHP — so it writes a
## working `.upsun/config.yaml` the first time instead of learning by failed
## deploy. The MCP server answers the same questions over HTTP when no CLI is
## available.
##
##   bash core/scripts/upsun-ai.sh            install the skill, register the MCP
##   bash core/scripts/upsun-ai.sh --check    report, change nothing
##   bash core/scripts/upsun-ai.sh --quiet     only speak when something is wrong
##
## Two deliberate choices:
##
## - **The MCP is registered read-only** (`enable-write: false`, which is Upsun's
##   own default). This is a CLI that manages live client environments; an agent
##   that can read them is useful, an agent that can change them is a decision for
##   a person, per environment, not a default of a setup script.
## - **The skill is copied, not symlinked**, into ~/.claude/skills/upsun — the same
##   place cmd-tools-ai-items.sh installs Webship's own skills, so it is visible to
##   `--source claude` and cannot vanish when a temporary clone is cleaned up.
##
## Self-contained plain bash, like trust-https.sh and host-mounts.sh beside it.
################################################################################

set -u

CHECK_ONLY='no'
QUIET='no'
while [ $# -gt 0 ]; do
  case "$1" in
    -c|--check) CHECK_ONLY='yes'; shift ;;
    -q|--quiet) QUIET='yes'; shift ;;
    -h|--help)  sed -n '3,33p' "${BASH_SOURCE[0]}" | sed 's/^## \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)"; exit 1 ;;
  esac
done

REPO='https://github.com/upsun/ai.git'
SKILL_SRC='plugins/upsun/skills/upsun'
SKILL_DEST="${HOME}/.claude/skills/upsun"
MCP_URL='https://mcp.upsun.com/mcp'

function say()  { [ "${QUIET}" == 'yes' ] || echo "$@" ; }
function warn() { echo "$@" ; }
function have() { command -v "$1" > /dev/null 2>&1 ; }

PROBLEMS=0

# ------------------------------------------------------------------- the skill ---

skill_installed='no'
[ -f "${SKILL_DEST}/SKILL.md" ] && skill_installed='yes'

if [ "${skill_installed}" == 'yes' ] ; then
  say "  ✓ upsun skill      ~/.claude/skills/upsun ($(find "${SKILL_DEST}" -type f | wc -l) files)"
elif [ "${CHECK_ONLY}" == 'yes' ] ; then
  warn "  ✗ upsun skill      not installed — an agent has to learn the Upsun CLI by failing"
  PROBLEMS=$((PROBLEMS + 1))
else
  if ! have git ; then
    warn "  ✗ git is needed to fetch the skill."
    PROBLEMS=$((PROBLEMS + 1))
  else
    tmp="$(mktemp -d)"
    # A shallow clone: this is 164KB of Markdown, and none of its history matters here.
    if git clone --quiet --depth=1 "${REPO}" "${tmp}/ai" 2>/dev/null \
       && [ -f "${tmp}/ai/${SKILL_SRC}/SKILL.md" ] ; then
      mkdir -p "${HOME}/.claude/skills"
      rm -rf "${SKILL_DEST}"
      cp -r "${tmp}/ai/${SKILL_SRC}" "${SKILL_DEST}"
      say "  ✓ upsun skill      installed to ~/.claude/skills/upsun ($(find "${SKILL_DEST}" -type f | wc -l) files)"
    else
      warn "  ✗ could not fetch ${REPO} — check network access to GitHub."
      PROBLEMS=$((PROBLEMS + 1))
    fi
    rm -rf "${tmp}"
  fi
fi

# --------------------------------------------------------------------- the MCP ---

if ! have claude ; then
  say "  – upsun MCP        skipped: the claude CLI is not installed"
else
  if claude mcp get upsun > /dev/null 2>&1 ; then
    say "  ✓ upsun MCP        registered (claude mcp get upsun)"
  elif [ "${CHECK_ONLY}" == 'yes' ] ; then
    warn "  ✗ upsun MCP        not registered"
    PROBLEMS=$((PROBLEMS + 1))
  else
    # enable-write: false is Upsun's own default and it stays that way here: see the
    # header. The token comes from the environment so no credential is written into
    # ~/.claude.json — ${UPSUN_API_TOKEN} is expanded when the server is loaded.
    if claude mcp add --transport http upsun "${MCP_URL}" -s user \
         --header 'upsun-api-token: ${UPSUN_API_TOKEN:-}' \
         --header 'enable-write: false' > /dev/null 2>&1 ; then
      say "  ✓ upsun MCP        registered read-only at ${MCP_URL}"
    else
      warn "  ✗ could not register the upsun MCP server with the claude CLI."
      PROBLEMS=$((PROBLEMS + 1))
    fi
  fi
fi

# ------------------------------------------------------------------ what next ---

say ""
if [ "${CHECK_ONLY}" == 'yes' ] ; then
  [ "${PROBLEMS}" -eq 0 ] && { say "Upsun's AI toolkit is installed."; exit 0; }
  warn "Upsun's AI toolkit is incomplete — run without --check to install it."
  exit 1
fi

if [ "${PROBLEMS}" -eq 0 ] ; then
  say "Upsun's AI toolkit is installed. Two things it needs from you:"
  say "  • The skill reaches a session after a restart."
  say "  • The MCP authenticates with an UPSUN API token, not the browser session:"
  say "      export UPSUN_API_TOKEN=…    (Upsun console → My profile → API tokens)"
  say "    It must be an Upsun token — an Atlassian token is refused with a message"
  say "    that reads like an expiry rather than the wrong kind of token."
  exit 0
fi
exit 1
