# Audio

Voices and sounds — voiceovers, voice samples, narration takes, effects and music.

This folder is part of the **Webship Workspace** (`~/workspace`), a container-based harness (DDEV by default).

## Agent

Use the **`webship-workspace`** agent here. A narrated video's final voiceover is made by
**`elevenlabs-voiceover`** and lands beside the video in `videos/`; samples and loose
audio belong here.

## Skills

- **`webship-workspace-dashboard`**

## Playing them

The dashboard lists every file at `https://audio.workspace.ddev.site` with a **Play**
button that opens the sound player in the editor modal (speed and loop included). Files
are served from `/files/audio/<path>` with an `audio/*` content type and byte-range
support, so seeking works. `voices/` and `sounds/` open as folders.

## Generating voices

`cmd-tools-voice.sh` makes a voice with **Piper** (the voice-narration skill, free, local) or
**ElevenLabs** (when a key is set): `-a engines`, `-a voices --engine X`, `-a speak` for a text,
`-a voiceover` for a script or transcript spoken over a video as a new video, `-a sound` and `-a music`
(ElevenLabs) for a sound effect or music from a description. Each leaves the text and a record beside the file. ElevenLabs spends
credits, so it prints a plan and stops until `--confirm`; ask first, and never read or print the key.
The dashboard's **Generate voice** form runs the same command.

## Conventions

- Name a file after what it is and the date: `<topic>-<YYYY-MM-DD>.mp3`.
- Put speech in `voices/` and everything else in `sounds/`.
- A doc that links one uses `../audio/<path>`.

The full architecture is in `products/workspace/CLAUDE.md`.

## Hard rules

- **Clean up after your own work, and ASK before you do.** A file or folder you created to try
  something out is yours to clear: when the goal is met, say plainly what you made and offer to
  remove it. Never delete it unasked — the user may still want to look — and never walk away leaving
  it unmentioned either.
- **Never put a key, token or password in a file here.** Audio comes from services that hold
  credentials; those stay in `settings.yml`, never in a note beside the audio.

**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync to Drive** button) pushes this folder to its Google Drive folder, new and changed files only, never deleting; `--dry-run` previews and `-a register` adds the Google Drive MCP server to Claude Code. Settings: `google_drive:` in `core/config/settings.yml`.
