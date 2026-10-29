# Constitution — RightUp

> **Draft.** Written from the repository as it stands on 26 September 2026 — `composer.json`,
> `recipe.yml`, `AGENTS.md`, the config and content directories, and the tag history. Everything
> here is checkable against the tree. The Roadmap and Open questions are a maintainer's to fill.

## Identity

| | |
|---|---|
| **Package** | `drupal/rightup` |
| **Type** | `drupal-recipe` (a **Site** recipe) |
| **Lives at** | drupal.org/project/rightup · git.drupalcode.org/project/rightup |
| **Release line** | `1.0.x` — **pre-release only**: `1.0.0-alpha1`, `1.0.0-beta1`, `1.0.0-rc1`. No stable 1.0.0 yet |
| **Built on** | `drupal/core ^11.4`, the Drupal CMS 2.x recipes, the `varbase_*_base` recipes `~1.0.0` |
| **Theme** | `drupal/vartheme_bs5_rightup ~1.0.0` — a Bootstrap 5.3 clone of `vartheme_bs5` |
| **Checked out here** | `products/rightup` |
| **Descended from** | `varbase_starter` |

The pre-release state is the single most important fact about this product today, and every
statement below should be read against it: **this is the youngest of the four templates.**

## Mission

**What it is.** A site template for **news sites, magazines and editorial teams**: home, blog,
features and contact pages, with articles, categories and tags, a media library, search and a
contact form.

**Who it is for.** An editorial team — the desk that publishes several times a day, needs the
article to look right in a listing and on a phone, and cares about how a story is found afterwards.

**The job it does.** Media is a sector Vardot publishes in. This template is a newsroom's shape
already built: the article model, the taxonomy, the curated listings, and a theme that treats a
story as the unit rather than a page.

## Scope

| In scope | Out of scope |
|---|---|
| The **editorial content model** — articles, categories, tags, and curated ordering | Anything every site needs: `varbase_starter`'s or a base recipe's |
| Curated listings and queues (`drupal/entityqueue ^1.7` is required for exactly this) | A publisher's own sections, mastheads or brand |
| News, blog and podcast surfaces (`varbase_news_base`, `varbase_blog_base`, `varbase_podcasts_base`) | Theme internals — `vartheme_bs5_rightup`'s |
| Search over editorial content (`varbase_search_base`) | Paywalls, subscriptions, ad serving, syndication contracts |
| Installing green through drush **and** the browser installer's template picker | Comment moderation policy, or anything about a publisher's editorial judgement |

`entityqueue` is the tell: this template is about **curation**, not only publication. A newsroom
decides what leads, and the model has to carry that.

## Tech stack

| Layer | What | What it decides |
|---|---|---|
| Core | `drupal/core ^11.4` | Level with the Starter — Starter changes port here most easily of the three sector templates |
| Base | `drupal_cms_*` ~2 | Admin UI, anti-spam, auth, forms, media, privacy, SEO, search, accessibility |
| Varbase layer | `varbase_*_base ~1.0.0`, pinned | Adds `varbase_news_base`, `varbase_blog_base`, `varbase_podcasts_base`, `varbase_search_base` |
| Curation | `drupal/entityqueue ^1.7` | Ordered, hand-picked lists are part of the product |
| Page building | Drupal Canvas | Pages are component trees in `content/canvas_page` |
| Theme | `vartheme_bs5_rightup` | Bootstrap-first, SDC-based. The theme has had the most component work of the family — banner, hero slider, live feed, search, share, footer |

## Structure

- `recipe.yml` — the ordered recipe list and install actions.
- `config/` — the Canvas component definitions and two views.
- `content/` — `canvas_page`, `node`, `taxonomy_term`, `media`, `file`, `menu_link_content`, `user`.
- `CHANGELOG.md` — read it before proposing a change.

Unlike Educare and Horizon Aid, this recipe declares **no `node.type.*` of its own**: its content
model comes from the `varbase_news_base` / `varbase_blog_base` recipes. That is a genuine
architectural difference between the siblings, and a change that assumes "the template owns its
content type" will be wrong here.

## Norms

Workspace-wide norms are in `core/config/norms.yml`. On top of those:

- **Configuration stays in the recipe**, never `config/install` or `config/optional`.
- **Commit messages** in the Drupal commit-type format: `{type}: #{issueID} Summary`.
- **`## [Unreleased]` in `CHANGELOG.md`** with every change.
- **Content types come from the base recipes.** If a change needs a new bundle, the question is
  whether it belongs in `varbase_news_base` — where every media site would get it — before it is
  added here.
- **Theme changes go to `vartheme_bs5_rightup`.**

## Safeguards

- **Never bump the version or tag a release without explicit maintainer approval.** The theme
  releases before the recipe.
- **While the line is pre-release, do not describe it as production-ready** — in a README, a demo, a
  proposal or a client conversation. It has no stable tag.
- **No real publication's articles, mastheads, bylines or images in the demo content.** It ships to
  everyone, and a plausible-looking fake newspaper is a liability.
- **The recipe must install green both ways** — drush and the browser installer's template picker.
- **Released tags are immutable**, pre-release tags included.

## Roadmap

| Phase | State | What it means |
|---|---|---|
| 1.0.0 pre-releases | **Current** — alpha1 → beta1 → rc1 | The model and the theme components are still settling |
| Stable 1.0.0 | Not yet | The gate is a maintainer's to state — see Open questions |
| Theme component work | Active | Banner, hero slider, live feed, search, share, footer all have their own branches |
| Public demo | **On hold** | The workspace records a decision of 27 August 2026 not to build the RightUp public demo while there is no released tag and the theme is a work in progress |
| Sandbox | Running | `sandboxes/rightup-sandbox-1` |

## How a change here is verified

```bash
# On Varbase 11, from the workspace, on DDEV:
cd ~/workspace/dev && bash cmd-rightup1-0-x-project.sh ru1 --install

# On Drupal CMS 2:
cd ~/workspace/dev && bash cmd-drupalcms2-x-rightup1-0-x-project.sh rucms1 --install
```

Then, in a browser: an article renders, the listings and curated queues are in the right order, the
hero and live-feed components work, search returns articles, and the share controls behave. There are
test projects for the awkward ones (`test/rua11yd1`, `test/rucms2`, `test/rucmsfresh`, `test/rufc`).

## Open questions

| Question | Who decides | What it blocks |
|---|---|---|
| What has to be true for a stable **1.0.0**? | Product owner | The public demo, and any client proposal naming RightUp |
| Should the article model move into this recipe, or stay in `varbase_news_base`? | Maintainers | Every "add a field to article" request |
| Is podcasting a first-class surface or an option? It ships `varbase_podcasts_base` — no sibling does | Product owner | What the template promises a newsroom |
| Multilingual: it does not ship `varbase_i18n_base`. Deliberate? | Product owner | International publishers |
