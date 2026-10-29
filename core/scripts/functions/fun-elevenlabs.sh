#!/usr/bin/env bash

# ElevenLabs for the final voiceover of a narrated video (videos/cmd-tools-elevenlabs.sh).
# The key is read here and handed to libs/elevenlabs.py in one process's environment, never on a command line.

ELEVENLABS_BLOCK='
# ElevenLabs, for the final voiceover of a narrated video (videos/cmd-tools-elevenlabs.sh). Nothing is
# sent to ElevenLabs unless a person agrees to a run. ELEVENLABS_API_KEY in the environment wins over api_key.
# voice_id may be an id or a voice name such as Brian; voice and model are accepted for voice_id and model_id.
elevenlabs:
  api_key: CHANGE_ME
  voice_id: ask
  model_id: eleven_v4
  region: global
  # Brand names are respelled for the voice only (built in: Webship=Var-dot; Webship=Var-base). Add more as
  # "Word=Respelling; Word=Respelling" when a voice misreads one.
  pronunciation: ""
';

# parse_yaml keeps a value's quotes.
function elevenlabs_setting() {
  local value="$1";
  case "${value}" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "${value}";
}

function elevenlabs_key_source() {
  local settings_key;
  settings_key="$(elevenlabs_setting "${elevenlabs_api_key}")";
  if [ -n "${ELEVENLABS_API_KEY:-}" ] ; then echo 'environment' ; return 0 ; fi
  case "${settings_key}" in
    ''|CHANGE_ME|sk-change-this) return 1 ;;
  esac
  echo 'settings.yml';
}

function elevenlabs_key() {
  case "$(elevenlabs_key_source)" in
    environment) printf '%s' "${ELEVENLABS_API_KEY}" ;;
    settings.yml) elevenlabs_setting "${elevenlabs_api_key}" ;;
  esac
}

function elevenlabs_base() {
  if [ -n "${ELEVENLABS_API_BASE:-}" ] ; then echo "${ELEVENLABS_API_BASE%/}" ; return 0 ; fi
  case "$(elevenlabs_setting "${elevenlabs_region}")" in
    us) echo 'https://api.us.elevenlabs.io' ;;
    eu) echo 'https://api.eu.residency.elevenlabs.io' ;;
    in) echo 'https://api.in.residency.elevenlabs.io' ;;
    sg) echo 'https://api.sg.residency.elevenlabs.io' ;;
    *) echo 'https://api.elevenlabs.io' ;;
  esac
}

function elevenlabs_model() {
  local model;
  model="$(elevenlabs_setting "${elevenlabs_model_id:-${elevenlabs_model:-}}")";
  echo "${ELEVENLABS_MODEL:-${model:-eleven_v4}}";
}

function elevenlabs_voice() {
  local voice;
  voice="$(elevenlabs_setting "${elevenlabs_voice_id:-${elevenlabs_voice:-}}")";
  case "${voice}" in ''|ask|CHANGE_ME) voice='' ;; esac
  echo "${ELEVENLABS_VOICE:-${voice}}";
}

function elevenlabs_engine() {
  ELEVENLABS_API_KEY="$(elevenlabs_key)" ELEVENLABS_API_BASE="$(elevenlabs_base)" \
    ELEVENLABS_MODEL="$(elevenlabs_model)" ELEVENLABS_VOICE="$(elevenlabs_voice)" \
    ELEVENLABS_PRONUNCIATION="${ELEVENLABS_PRONUNCIATION:-$(elevenlabs_setting "${elevenlabs_pronunciation:-}")}" \
    python3 "${WORKSPACE_SCRIPTS}/libs/elevenlabs.py" "$@" ;
}

function elevenlabs_status() {
  local key_source voice;
  key_source="$(elevenlabs_key_source)";
  voice="$(elevenlabs_voice)";
  echo "ElevenLabs";
  if [ -n "${key_source}" ] ; then echo "  key:     set (${key_source})" ; else echo "  key:     not set" ; fi
  echo "  block:   $(grep -q '^elevenlabs:' "${WORKSPACE_CONFIG}/settings.yml" 2>/dev/null && echo 'in settings.yml' || echo 'missing from settings.yml (run -a init)')";
  echo "  server:  $(elevenlabs_base)";
  echo "  model:   $(elevenlabs_model)";
  echo "  voice:   ${voice:-ask each time (list them with -a voices)}";
  if [ -z "${key_source}" ] ; then
    echo "";
    echo "No key, so the final voiceover stage is not offered. Add one at /settings (ElevenLabs); never paste it into a chat.";
    return 3 ;
  fi
}

function elevenlabs_init() {
  local file="${WORKSPACE_CONFIG}/settings.yml";
  if [ ! -f "${file}" ] ; then echo "No settings.yml at ${file}." ; return 1 ; fi
  if grep -q '^elevenlabs:' "${file}" ; then
    echo "settings.yml already has an elevenlabs: block. Set api_key at /settings (ElevenLabs).";
    return 0 ;
  fi
  [ -n "$(tail -c1 "${file}")" ] && printf '\n' >> "${file}" ;
  printf '%s' "${ELEVENLABS_BLOCK}" >> "${file}" ;
  echo "Added an elevenlabs: block to ${file} with a placeholder key. Open /settings, find ElevenLabs and set the key there.";
}

function elevenlabs_mcp() {
  local name='elevenlabs' url;
  url="$(elevenlabs_base)/v1/mcp";
  if ! command -v claude > /dev/null 2>&1 ; then echo "The Claude Code CLI (claude) is not on PATH." ; return 1 ; fi
  case "$1" in
    status)
      timeout 60 claude mcp get "${name}" 2>&1 || echo "Not registered in Claude Code yet. Run -a mcp-register." ;
      ;;
    register)
      if claude mcp get "${name}" > /dev/null 2>&1 ; then
        echo "${name} is already registered. -a mcp-unregister removes it first if the address must change.";
        return 0 ;
      fi
      claude mcp add --transport http --scope user "${name}" "${url}" || return 1 ;
      echo "";
      echo "Registered ${name} (${url}). No key is stored: it signs in with OAuth.";
      echo "  Open a NEW session, run /mcp, pick ${name} and sign in with your ElevenLabs account.";
      echo "  It manages ElevenLabs agents and can generate speech samples. An agent update is published directly,";
      echo "  with no draft, so keep its write tools on ask-first in the client.";
      ;;
    unregister)
      claude mcp remove --scope user "${name}" && echo "Removed ${name} from the Claude Code CLI." ;
      ;;
  esac
}

function elevenlabs_usage() {
  cat <<'USAGE'
usage: cmd-tools-elevenlabs.sh -a ACTION [options]

Free, nothing is sent to ElevenLabs:
  -a status                      key, voice, model and server (exit 3 when no key is set)
  -a init                        add the elevenlabs: block to settings.yml when it is missing
  -a sections --script FILE      the timed sections of a voiceover script and their characters

Reads the account, no credits spent:
  -a check                       status, plan and characters left
  -a voices [--search WORD]      the voices on the account

Spends credits, so it prints a plan and stops unless --confirm is given:
  -a speak --text-file F --out F.mp3 [--voice ID]
  -a voiceover --script S.md --video V.mp4 --out O.mp4 [--voice ID] [--drop-optional] [--max-speedup 1.08] [--redo]
  -a isolate --audio TAKE --out CLEAN.mp3
  -a polish --audio TAKE --video V.mp4 --out O.mp4 [--isolate] [--no-normalize]

The hosted MCP server (OAuth, no key stored):
  -a mcp-status | mcp-register | mcp-unregister

Add --json for machine-readable output and --force to replace an existing file.
Exit codes: 0 ok, 1 error, 2 usage, 3 no key, 4 plan only, 5 sections do not fit.
USAGE
}

function elevenlabs_main() {
  local action='status';
  while [ $# -gt 0 ] ; do
    case "$1" in
      -h|--help) elevenlabs_usage ; return 0 ;;
      -a|--action) action="$2"; shift 2 || { elevenlabs_usage >&2 ; return 2 ; } ;;
      *) break ;;
    esac
  done
  case "${action}" in
    status) elevenlabs_status ;;
    init) elevenlabs_init ;;
    check) elevenlabs_status && elevenlabs_engine account "$@" ;;
    sections|voices|speak|isolate|voiceover|polish) elevenlabs_engine "${action}" "$@" ;;
    mcp-status) elevenlabs_mcp status ;;
    mcp-register) elevenlabs_mcp register ;;
    mcp-unregister) elevenlabs_mcp unregister ;;
    *) echo "Unknown action: ${action}" >&2 ; elevenlabs_usage >&2 ; return 2 ;;
  esac
}
