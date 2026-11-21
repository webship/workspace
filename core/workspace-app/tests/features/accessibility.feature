@a11y
Feature: Every page and every Settings tab passes an axe-core audit
  axe-core, through webship-js, checks each page against every rule it has: WCAG 2.0, 2.1 and 2.2 at A and
  AA, and the best practices. Each page is checked in the light style and in the dark one, so a colour that
  reads in one and not in the other is caught. A page that passes today and fails tomorrow has regressed.

  The pages are the base's own. The workspace pages are the ones the home links to, and the Settings tabs
  the ones the modal draws, so a workspace or a plugin added later is audited too.

  Scenario Outline: <page> has no accessibility violation, in the light style and the dark one
    Given I am on "<page>"
     Then the page should have no accessibility violations
    Given the local storage "ws-theme" is set to "dark"
     When I reload the page
     Then the page should have no accessibility violations

    Examples:
      | page                             |
      | /                                |
      | /screens                         |
      | /help                            |
      | /commands                        |
      | /changelog                       |
      | /dev/backups                     |
      | /settings                        |
      | /settings/plugins                |
      | /settings/settings.yml           |
      | /settings/navigation             |
      | /settings/buttons                |
      | /settings/command-order          |
      | /settings/styles                 |
      | /settings/plugin/workspace-notes |

  Scenario: Every workspace page has no accessibility violation, in the light style and the dark one
    Given I am on "/"
     Then every workspace page should have no accessibility violations, in the light style and the dark one

  Scenario: Every tab of the Settings modal has no accessibility violation, in the light style and the dark one
    Given I am on "/"
     Then every tab of the Settings modal should have no accessibility violations, in the light style and the dark one
