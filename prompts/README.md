# AI Prompts

Prompts worth keeping: the ones that took a few attempts to get right, so the next person does not
start from a blank line.

Each is a copy-paste `claude` invocation with the constraints already in it — which project, which
domain, DDEV only, test in a real browser, stop when the tests pass. The placeholders in angle
brackets are what you fill in.

They are written for whatever this workspace builds — plain Drupal, Drupal CMS, Webship — so a
prompt names `<distribution>` rather than one of them. Substitute it and the rest holds.

| Prompt | For |
| --- | --- |
| `loop-until-green.md` | keep working until the goal is met and the tests pass |
| `fresh-build-and-test-round.md` | build a project from nothing and run its suite |
| `failed-scenarios-triage.md` | work out why scenarios failed, and which failures share a cause |
| `upgrade-line-test.md` | check an upgrade between two lines |
| `release-after-core-update.md` | cut a release once Drupal core has moved |
| `security-release-response.md` | respond to a security release |
| `module-check-on-a-distribution.md` | check a contrib module against a distribution |
| `compare-two-distributions.md` | compare what two distributions actually install |
| `canvas-component.md` | build a Drupal Canvas component |
| `drupal-issue-and-mr.md` | open a drupal.org issue and its merge request |
| `agent-memory.md` | give an agent what it should remember |

Read them from the dashboard at `https://prompts.workspace.ddev.site`, where each is editable and
installable into `~/.claude/commands/`.
