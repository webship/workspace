# Designs

Design sources and exports: Figma frames, mockups, style sheets and brand assets, plus the
flattened PNG/SVG/PDF versions that go to a client or into an issue.

Browse them at <https://designs.workspace.ddev.site> — each row has **Review** (opens the
image or PDF in place) and **Download**. Search, sort and paging work as they do in Docs
and Videos.

Figma stays the source of truth; keep the file URL and node id discoverable from the export's
name or a sibling `.md`. See `AGENTS.md` for the conventions and which agent to use.

## Penpot

This workspace also runs Penpot self-hosted in DDEV, one instance per design system:

```bash
bash cmd-penpot-project.sh penpot-educare
```

It builds the DDEV project, the Penpot services and the nginx reverse proxy, then registers the
first account, and prints the one URL to open. Defaults live in `penpot:` in
`core/config/workspace.designs.settings.yml`; `cmd-penpot-backup.sh`, `cmd-penpot-token.sh` and
`cmd-penpot-mcp.sh` cover backups, an access token for the Drupal AI Penpot module, and the MCP
server a design agent connects to. `AGENTS.md` has the three traps worth knowing first.
