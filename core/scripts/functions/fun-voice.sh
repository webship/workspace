#!/usr/bin/env bash

# Voices for the audio workspace: Piper (voice-narration) and ElevenLabs, one text spoken to one file.
# The engine and its arguments are in libs/voice.py; this only hands it the ElevenLabs settings.

function voice_engine() {
  ELEVENLABS_API_KEY="$(elevenlabs_key)" ELEVENLABS_API_BASE="$(elevenlabs_base)" \
    ELEVENLABS_MODEL="$(elevenlabs_model)" ELEVENLABS_VOICE="$(elevenlabs_voice)" \
    python3 "${WORKSPACE_SCRIPTS}/libs/voice.py" "$@" ;
}

function voice_usage() {
  cat <<'USAGE'
usage: cmd-tools-voice.sh -a ACTION [options]

  -a engines [--json]                         which engines this machine can use, and why not
  -a voices --engine piper|elevenlabs         the voices of one engine [--search WORD] [--limit N]
  -a speak --engine piper|elevenlabs --text-file F --out F.wav|F.mp3 [--voice ID] [--model ID]
  -a voiceover --engine piper|elevenlabs --script S.md --video V.mp4 --out O.mp4 --voice ID [--model ID] [--drop-optional]
                                              a timed voiceover script, or any transcript, spoken over a video
  -a sound --text-file F --out F.mp3 [--duration 0.5-30] [--loop] [--influence 0-1]   (ElevenLabs)
                                              a sound effect from a description
  -a music --text-file F --out F.mp3 [--length 3-600] [--instrumental]                 (ElevenLabs)
                                              music from a description

Piper is free and local. ElevenLabs spends credits, so speak, voiceover, sound and music print a plan and stop
unless --confirm is given. An existing output is refused unless --force. Add --json for machine-readable output.
Exit codes: 0 ok, 1 error, 2 usage, 3 no key, 4 plan only.
USAGE
}

function voice_main() {
  local action='engines';
  while [ $# -gt 0 ] ; do
    case "$1" in
      -h|--help) voice_usage ; return 0 ;;
      -a|--action) action="$2"; shift 2 || { voice_usage >&2 ; return 2 ; } ;;
      *) break ;;
    esac
  done
  case "${action}" in
    engines|voices|speak|voiceover|sound|music) voice_engine "${action}" "$@" ;;
    *) echo "Unknown action: ${action}" >&2 ; voice_usage >&2 ; return 2 ;;
  esac
}
