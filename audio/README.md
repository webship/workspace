# Audio

Voices and sounds: voiceovers and voice samples, narration takes, sound effects and music.

Play them from the dashboard at `https://audio.workspace.ddev.site` — each file has a
**Play** button that opens a sound player in a modal, with speed and loop. Files are served
from `/files/audio/<path>` with a real `audio/*` content type and byte-range support, so
seeking works.

Keep it tidy with two folders, which the page lets you open:

- `voices/` — narration, voiceovers, voice samples and the takes they came from.
- `sounds/` — effects, music and other non-speech audio.

## Sounds and what belongs to them

The page lists **sounds**, as Videos lists recordings, and nothing else: mp3, wav, ogg, opus, m4a, aac and
flac. What belongs to a sound is part of its row, not a row of its own:

- its **cover**, a picture beside it (`rain.jpg`, or `rain-cover.png`), which is the card's picture;
- the **text** it was made from or speaks (`rain.txt`, or `rain-transcript.md`), behind the row's button;
- the **record** of how it was made (`rain.json`: engine, voice, model, length, when).

Playing a sound shows the record and the text under the player, with speed from 0.5x to 5x and loop.

## Generate

The page's actions each open their own modal:

- **Generate voice** — type or paste up to 5,000 characters, choose an engine and a voice.
- **Voice over a video** — choose a video from `videos/` and a script from `docs/` (or paste a script or
  any transcript), check the plan, and a **new video** with that voice is saved in `videos/`. A timed
  voiceover script puts each section in its window; a plain transcript is spread over the whole video.
  The original is never changed.
- **Generate a sound** — describe a sound effect, choose its length, loop and how closely to follow you.
- **Generate music** — describe the music, choose its length, with or without vocals.

Voices and sounds are saved in `voices/` and `sounds/` with their text and record. **Piper** is the
voice-narration skill's local voice: free, offline, no key. **ElevenLabs** appears when a key is set in
`settings.yml`, lists the voices that key may read and shows the credits left; sounds and music need the
sound-effects and music permissions on the key. It always asks before spending. The same from a terminal:

```bash
bash cmd-tools-voice.sh -a engines
bash cmd-tools-voice.sh -a speak --engine piper --text-file hello.txt --out voices/hello.wav
bash cmd-tools-voice.sh -a voiceover --engine elevenlabs --script s.md --video v.mp4 --out o.mp4 --voice ID
bash cmd-tools-voice.sh -a sound --text-file rain.txt --out sounds/rain.mp3 --duration 4 --confirm
```

Name a file after what it is and the date: `<topic>-<YYYY-MM-DD>.mp3`. mp3, wav, ogg, opus,
m4a, aac and flac play in the browser.

**Google Drive.** `bash cmd-tools-google-drive-sync.sh` (or the **Sync to Drive** button) pushes this folder to its Google Drive folder, new and changed files only, never deleting; `--dry-run` previews and `-a register` adds the Google Drive MCP server to Claude Code. Settings: `google_drive:` in `core/config/settings.yml`.
