# Avatars

Talking AI characters, each a DDEV project built from the avatar app (a Node app, no database).

This folder is part of the **Webship Workspace** (`~/workspace`), a container-based harness (DDEV by default). Run its `cmd-*.sh`
from here.

## Agent

Use the **`webship-workspace`** agent for the folder itself. A character's own agent is its mind:
`avatar-<character id>`, kept in the project's `claude/agents/` and linked into `~/.claude/agents/`.

## Skills

- **`webship-workspace-dashboard`**
- **`voice-narration`** — Piper voices on this machine.
- **`elevenlabs-voiceover`** — ElevenLabs, which spends credits.

## Commands here

```bash
bash cmd-avatar-project.sh --help
bash cmd-tools-avatar-agent.sh --help
bash cmd-tools-avatar-catalog.sh --help
bash cmd-tools-avatar-character.sh --help
bash cmd-tools-avatar-voice.sh --help
bash cmd-tools-reclaim.sh --help
bash cmd-tools-remove.sh --help
bash cmd-tools-screen.sh --help
```

## Hard rules

- **Containers only (DDEV by default).** The app runs in its web container; never run `node` or `npm` for it on the host.
- **A hostname belongs to one project.** A new avatar project drops any extra hostname the avatar app
  repository declares (`cmd-avatar-project.sh` does), so two avatars never answer on one address.
- **ElevenLabs spends money.** Never link a key or design a voice without the person asking.
- **Licences are per model and per voice.** Record the credit and licence with every character, and never
  publish a fan-made or "author only" model.
- **Agents live in the project** (`claude/agents/`), linked into `~/.claude` — edit them there, not the link.
- **Clean up after your own work, and ASK before you do.** Removing a project is `bash cmd-tools-remove.sh
  <project>`, never `rm -rf`.

The full architecture is in `products/workspace/CLAUDE.md`.
