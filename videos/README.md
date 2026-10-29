# Videos

Recorded walkthroughs and demos, with their poster frames.

Play them from the dashboard at `https://videos.workspace.ddev.site` — each video has a
**Play** button that opens it in a modal. They are served with a real `video/*` content
type and byte-range support, so seeking works rather than forcing a full download.

Name a recording `<topic>-<YYYY-MM-DD>.mp4` and keep its poster as
`<same-stem>-poster.jpg`. A doc that embeds one links `../videos/<name>`.

Each video row has an **Edit** button that makes a new version of it (`<name>-v2.mp4`): a new voice, the
Vardot logo before or after it, music under either end, a different speed or length, a section removed or
added, or a plain copy to re-work. The original is never changed and its script is rewritten beside the new
one. The same command runs by hand: `bash cmd-tools-video-edit.sh --help`.

The final voiceover of an approved draft can be made with ElevenLabs: set the key at `/settings`, then
`bash cmd-tools-elevenlabs.sh --help`. Nothing is sent until a run is confirmed.

**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync to Drive** button) pushes this folder to its Google Drive folder, new and changed files only, never deleting; `--dry-run` previews and `-a register` adds the Google Drive MCP server to Claude Code. Settings: `google_drive:` in `core/config/settings.yml`.
