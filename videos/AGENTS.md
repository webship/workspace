# Videos

Recorded walkthroughs and demos — the narrated `.webm` and `.mp4` files the
documentation and demo agents produce, with their poster frames beside them.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness.

## Agent

Use the **`webship-workspace`** agent here. For recording a new walkthrough use
**`varbase-demo-video-manager`**, which drives the browser, narrates with Piper and
muxes the result with ffmpeg.

## Skills

- **`webship-workspace-dashboard`**
- **`vardot-elevenlabs-voiceover`**: the final voiceover of an approved draft
- **`vardot-elevenlabs-hosted-mcp`**: ElevenLabs' hosted MCP server

## Playing them

The dashboard lists every video at `https://videos.workspace.ddev.site` with a **Play**
button that opens it in the same modal the editors use. Files are served from
`/files/videos/<name>` with a real `video/*` content type and byte-range support, so
seeking works.

## Editing a video

`cmd-tools-video-edit.sh -a edit --video V --out NEW [changes]` makes a new version and never touches the
original: `--speed`, `--length`, `--trim`, `--remove <section ids>`, `--add-title/--add-text/--add-after`
(a Vardot logo card, spoken by `--engine piper|elevenlabs`), `--intro-card`/`--outro-card` (the logo),
`--intro-music`/`--outro-music`, or `--clone` for a plain copy. The timed voiceover script is rewritten
for the new version. Only a section spoken with ElevenLabs spends credits, so it stops at a plan until
`--confirm`. A new voice over the whole video is `audio/cmd-tools-voice.sh -a voiceover`.

## The final voiceover

`cmd-tools-elevenlabs.sh` makes the final voiceover of an approved draft with ElevenLabs, or levels a
take a person recorded. It needs a key (`/settings`, ElevenLabs); without one the stage is not offered.
Anything that spends credits prints a plan and stops until it is run again with `--confirm`, so the
agent asks first. Run `bash cmd-tools-elevenlabs.sh --help` for the actions.

## Conventions

- Name a recording after what it shows and the date: `<topic>-<YYYY-MM-DD>.mp4`.
- Keep the poster frame beside it as `<same-stem>-poster.jpg` — the player uses it
  before playback starts, and Markdown can point at it.
- A doc that embeds one links `../videos/<name>` — the videos live in their own
  workspace, not under `docs/`.
- Drafts of one video are `<stem>-draft-<N>.mp4`. The approved draft with its final voiceover is
  `<stem>-final.mp4`, beside its `-voiceover.mp3`, `-voiceover.json` and poster.

The full architecture is in `products/workspace/CLAUDE.md`.

## Hard rules

- **Clean up after your own work, and ASK before you do.** A file or folder you created to try
  something out is yours to clear: when the goal is met, say plainly what you made and offer to
  remove it. Never delete it unasked — the user may still want to look — and never walk away leaving
  it unmentioned either.

**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync to Drive** button) pushes this folder to its Google Drive folder, new and changed files only, never deleting; `--dry-run` previews and `-a register` adds the Google Drive MCP server to Claude Code. Settings: `google_drive:` in `core/config/settings.yml`.
