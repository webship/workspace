#!/usr/bin/env bash

# Edit a video into a new version of itself. The work is in libs/video_edit.py; this hands it the ElevenLabs
# settings, which only a section added with that voice uses.

function video_edit_engine() {
  ELEVENLABS_API_KEY="$(elevenlabs_key)" ELEVENLABS_API_BASE="$(elevenlabs_base)" \
    ELEVENLABS_MODEL="$(elevenlabs_model)" ELEVENLABS_VOICE="$(elevenlabs_voice)" \
    python3 "${WORKSPACE_SCRIPTS}/libs/video_edit.py" "$@" ;
}

function video_edit_usage() {
  cat <<'USAGE'
usage: cmd-tools-video-edit.sh -a ACTION --video V.mp4 [options]

  -a info                                     size, frame rate and length
  -a edit --out NEW.mp4 [changes]             a new version with the changes; the original is never touched

changes (any number together):
  --speed 0.25-4          play faster or slower          --length 1:30   make it exactly that long
  --trim 0:05-0:40        keep only that stretch         --remove T03,T05  cut sections of the script out
  --add-title T --add-text "..." --add-after T03|start|end [--engine piper|elevenlabs --voice ID]
                          a new section: a Webship logo card, spoken by the voice
  --intro-card 3 [--intro-title T --intro-subtitle S]    the Webship logo before the video (1-10 seconds)
  --outro-card 3 [--outro-title T --outro-subtitle S]    the Webship logo after it
  --intro-music F --outro-music F [--intro-seconds 8 --outro-seconds 8 --music-volume 0.5]
  --clone                 a plain copy to re-work (what a new version starts as)
  --script S.md [--script-out O.md]   the timed voiceover script; it is rewritten for the new version

An existing output is refused unless --force. Only a section spoken with ElevenLabs spends credits: it prints
a plan and stops unless --confirm is given. Exit codes: 0 ok, 1 error, 2 usage, 3 no key, 4 plan only.
USAGE
}

function video_edit_main() {
  local action='edit';
  while [ $# -gt 0 ] ; do
    case "$1" in
      -h|--help) video_edit_usage ; return 0 ;;
      -a|--action) action="$2"; shift 2 || { video_edit_usage >&2 ; return 2 ; } ;;
      *) break ;;
    esac
  done
  case "${action}" in
    info|edit) video_edit_engine "${action}" "$@" ;;
    *) echo "Unknown action: ${action}" >&2 ; video_edit_usage >&2 ; return 2 ;;
  esac
}
