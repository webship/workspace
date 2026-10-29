# Constitution — Horizon Aid

> **Draft.** Written from the repository as it stands on 26 September 2026 — `composer.json`,
> `recipe.yml`, the config and content directories, and the tag history. Everything here is
> checkable against the tree. The Roadmap and Open questions are a maintainer's to fill.

## Identity

| | |
|---|---|
| **Package** | `drupal/horizonaid` |
| **Type** | `drupal-recipe` (a **Site** recipe) |
| **Lives at** | drupal.org/project/horizonaid · git.drupalcode.org/project/horizonaid |
| **Release line** | `1.0.x`, latest **1.0.4** |
| **Built on** | `drupal/core ^11.3`, the Drupal CMS 2.x recipes, the `varbase_*_base` recipes |
| **Theme** | `drupal/vartheme_bs5_horizonaid` — a Bootstrap 5.3 clone of `vartheme_bs5` |
| **Checked out here** | `products/horizonaid` |
| **Descended from** | `varbase_starter` |

## Mission

**What it is.** A site template for **NGOs, nonprofits and humanitarian aid organizations**. Its own
description names what it ships: country and programme profiles, events, a resource library and a
donation page.

**Who it is for.** The communications team of an aid organisation — the people who have to publish
where the organisation works, what it is doing there, and how to support it, usually under time
pressure and often in more than one language.

**The job it does.** Intergovernmental and nonprofit organisations are the sector Vardot works in
most visibly. This template is that experience productised: the content model an aid organisation
needs — **country** and **programme** — already built, with the listings and pages that go with them.

## Scope

| In scope | Out of scope |
|---|---|
| The **humanitarian content model** — `country` and `program` node types and their taxonomy | Anything every site needs: `varbase_starter`'s or a base recipe's |
| Country and programme profiles, events, the resource library, the donation page | A specific organisation's programmes, countries or financials |
| Its listings (two `views.view.*`) over that model | Theme internals — `vartheme_bs5_horizonaid`'s |
| Its Canvas page templates and component configuration | Payment processing. The donation **page** is in scope; a payment gateway integration is a project decision |
| Installing green through drush **and** the browser installer's template picker | Case management, beneficiary data, or anything holding personal data about people receiving aid |

That last exclusion is not a technical boundary, it is an ethical one: a public website template must
not become the place an organisation is tempted to keep data about vulnerable people.

## Tech stack

| Layer | What | What it decides |
|---|---|---|
| Core | `drupal/core ^11.3` | One minor behind the Starter — a Starter change on 11.4 cannot be copied down unchanged |
| Base | `drupal_cms_*` ~2 | Admin UI, anti-spam, auth, forms, media, privacy, SEO, search, accessibility |
| Varbase layer | `varbase_*_base 1.0.x-dev` | Includes `varbase_events_base` and `varbase_blog_base` — an aid site runs events and a blog |
| Page building | Drupal Canvas | Pages are component trees in `content/canvas_page` |
| Theme | `vartheme_bs5_horizonaid` | Bootstrap-first, SDC-based |

Note: this template pins the `varbase_*_base` recipes at `1.0.x-dev` where Educare and RightUp pin
`~1.0.0`. That is a real difference in behaviour between siblings and the first thing to check when
one of them breaks and the others do not.

## Structure

- `recipe.yml` — the ordered recipe list and install actions.
- `config/` — `node.type.country`, `node.type.program`, their fields and displays, the Canvas
  component definitions, two views.
- `content/` — `canvas_page`, `node` (the country and programme demo pages), `taxonomy_term`,
  `media`, `file`, `menu_link_content`.
- `CHANGELOG.md` — read it before proposing a change.

## Norms

Workspace-wide norms are in `core/config/norms.yml`. On top of those:

- **Configuration stays in the recipe**, never `config/install` or `config/optional`.
- **Commit messages** in the Drupal commit-type format: `{type}: #{issueID} Summary`.
- **`## [Unreleased]` in `CHANGELOG.md`** with every change.
- **Accessibility is a requirement here, not a polish pass.** The recent work on this repository is
  WCAG 2.2 AA; an aid organisation's audience includes people using assistive technology in poor
  conditions, on poor connections.
- **Theme changes go to `vartheme_bs5_horizonaid`.**
- **If a change would suit every sector template, it belongs in `varbase_starter`.**

## Safeguards

- **Never bump the version or tag a release without explicit maintainer approval.** The theme
  releases before the recipe.
- **No real organisation, beneficiary, location or financial data in the demo content.** It ships to
  everyone. Countries used as examples are examples.
- **The recipe must install green both ways** — drush and the browser installer's template picker.
- **Never let the donation page imply a payment integration that is not there.**
- **Released tags are immutable.**

## Roadmap

| Phase | State | What it means |
|---|---|---|
| 1.0.x on Varbase 11 | **Current** — 1.0.4 | Country and programme models, its own theme |
| WCAG 2.2 AA | In progress | Recent commits are accessibility work |
| On Drupal CMS 2 as a base | Buildable | `cmd-drupalcms2-x-horizonaid1-0-*-project.sh` |
| Demo and sandbox environments | Running | `sandboxes/horizonaid-sandbox-1`, `demos/horizonaid-public-demo-1`, `demos/horizonaid-client-demo-1` |

## How a change here is verified

```bash
# On Varbase 11, from the workspace, on DDEV:
cd ~/workspace/dev && bash cmd-horizonaid1-0-x-project.sh ha1 --install

# On Drupal CMS 2:
cd ~/workspace/dev && bash cmd-drupalcms2-x-horizonaid1-0-x-project.sh hacms1 --install
```

Then, in a browser: a country page, a programme page, the events listing, the resource library and
the donation page all render; the menus are right; the demo media is present. And an accessibility
pass — this template has test projects for it (`test/ha104check`, `test/haa11y1`).

## Open questions

| Question | Who decides | What it blocks |
|---|---|---|
| Is the donation page a template for an integration, or is an integration intended? | Product owner | What a client should expect out of the box |
| Is this template multilingual by default? It does **not** ship `varbase_i18n_base`, unlike Educare — deliberate or an oversight? | Product owner | Whether an aid organisation's first requirement is met or is a project |
| Should the base recipes be pinned `~1.0.0` like its siblings? | Maintainers | Whether a base change reaches this template differently from the others |
