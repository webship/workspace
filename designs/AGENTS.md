# Designs

Design sources and exports — the Figma frames, mockups, style sheets and brand assets a
build is made from, and the flattened `.png`/`.svg`/`.pdf` versions handed to a client or
pasted into an issue.

This folder is part of the **Webship Workspace** (`~/workspace`), a DDEV-only harness.

## Agent

Use the **`webship-workspace`** agent for anything about the folder itself. For the design
work, pick by direction:

- **`vardot-figma-designer`** — create or change a Figma file (code → design).
- **`varbase-11-figma-to-vartheme`** — turn a Figma design into `vartheme_bs5` SDCs.
- **`varbase11-figma-to-drupal-canvas-ai`** — assemble a Figma design as Drupal Canvas content.
- **`vardot-figma-bootstrap-designer`** / **`vardot-figma-uikit-designer`** — a design system
  in Figma from Bootstrap 5.3 or UIKit tokens.

## Skills

- **`webship-workspace-dashboard`**
- **`vartheme-figma-tokens-to-css3-variables`** — Figma variables → theme CSS custom properties.
- **`vardot-document-branding`** — the brand rules a client-facing export has to follow.

## Penpot, self-hosted

The folder also runs **Penpot** — one instance per design system, as DDEV projects beside the
exports:

```bash
bash cmd-penpot-project.sh                      # the default instance, from the settings
bash cmd-penpot-project.sh penpot-educare       # one per design system
bash cmd-penpot-project.sh penpot-educare --force   # rebuild; DELETES its database and assets
bash cmd-penpot-backup.sh penpot-educare        # the Postgres dump AND the asset volume
bash cmd-penpot-token.sh penpot-educare         # an access token for the Drupal AI Penpot module
bash cmd-penpot-mcp.sh penpot-educare -a start  # the Penpot MCP server, for design agents
bash cmd-tools-remove.sh penpot-educare         # ddev delete -y -O, then the directory
```

Every default lives in `core/config/workspace.designs.settings.yml` under `penpot:` — the project
name, the image version, `PENPOT_FLAGS`, the mail-catcher port, the public URI, and the account the
first registration uses (which falls back to the `account:` block in `settings.yml`, so a machine
states its developer identity once).

Three things to know before touching an instance:

- **It serves ONE origin.** Penpot's frontend fetches its API from `PENPOT_PUBLIC_URI`, so from any
  other hostname every call is cross-origin and CORS blocks it — the app boots to a blank page
  rather than an error. `public_uri: hub` makes that origin
  `https://<project>.designs.workspace.ddev.site`; the canonical `https://<project>.ddev.site` still
  serves the RPC API, where there is no browser to enforce CORS, but it is not a browser alias.
- **Each instance publishes a mail-catcher port**, so a fixed 1080 would make the second instance
  fail to start. The command takes the next free pair upwards and prints the one it used.
- **`enable-access-tokens` is not optional** for the Drupal AI Penpot module: without it a token is
  ignored *silently* — requests resolve to Anonymous rather than 401. It is in the default flags,
  along with `enable-plugins`, which is what the Penpot MCP needs.

### The MCP server: what works, and what does not

`cmd-penpot-mcp.sh -a start` runs the server **inside the instance's web-container network
namespace**, and the instance's nginx publishes it on the instance's own https origin:

| | |
|---|---|
| MCP endpoint | `<instance>/mcp` — 406 on a plain GET, which is correct |
| Plugin manifest | `<instance>/mcp-plugin/manifest.json` |
| Bridge | `wss://<instance>/mcp-bridge` |

That arrangement is not a preference. The servers bind **IPv6 loopback only**, so nothing on the
network can reach them and an IPv4 upstream 502s; the editor page is **https**, so an
`http://localhost:4400` manifest is mixed content and Penpot refuses it; and this machine's
firewall drops container-to-host traffic, so a relay on the host is unreachable too.

Because the container joins the web container's namespace, it must be started **after** the project
and restarted **with** it — a `ddev restart` destroys the namespace and leaves the routes on 502.

**Verified:** the server starts, the three routes answer, and `claude mcp list` reports the
instance connected. **Not verified:** installing the plugin inside the Penpot editor — it is still
refused for the same-origin manifest, so the browser bridge, and therefore `execute_code` against a
live file, does not work here yet. The Drupal AI Penpot path needs none of it.

A note for the Drupal side: server-to-server calls must use the **canonical**
`https://<project>.ddev.site`, not the hub hostname — the hub hostname fails TLS verification from
another container (`no alternative certificate subject name matches`). Browser origin = hub,
PHP/curl origin = canonical.

The full integration walkthrough (MCP, the Drupal module, design tokens to CSS) is
`products/ai_penpot/docs/penpot-on-ddev.md`.

## Viewing them

The dashboard lists every design at `https://designs.workspace.ddev.site` with **Review**,
which opens an image or a PDF in the same modal the editors use, and **Download**. Files are
served from `/files/designs/<name>`.

## Conventions

- **Figma is the source of truth.** What lives here is an export or a working file, not the
  master — put the Figma URL and node id in the filename or a sibling `.md` so the frame it
  came from is findable.
- Name an export after what it shows and where it belongs:
  `<project-or-theme>-<screen>-<state>.png`.
- Keep the brand tokens themselves in `products/workspace/core/config/brand-tokens.json`,
  refreshed by `core/scripts/brand-tokens.sh` — not as a copy in here.
- Client work is confidential: nothing in here goes into a public issue, PR or case study
  unless it is an approved published asset.

The full architecture is in `products/workspace/CLAUDE.md`.

## Hard rules

- **Clean up after your own work, and ASK before you do.** A scratch project you built to check
  something, a folder or file you made to test with: when the goal is met, say plainly what you
  created and offer to remove it. Never delete it unasked — the user may still want to look — and
  never walk away leaving it unmentioned either.
- **Removing a project is a command, not `rm -rf`.** `bash cmd-tools-remove.sh <project>` from this
  folder, or `ddev delete -y -O` inside the project. Deleting the folder alone leaves the DDEV
  registry entry, the database volume, the snapshots volume and the per-project built images behind —
  invisible until the disk is full. `cmd-tools-reclaim.sh` in this folder finds that debris afterwards, but
  not creating it is better.
