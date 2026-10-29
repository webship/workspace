Feature: The actions rail
  The rail on the right of every page collapses to its icons and remembers the choice.

  # This exists because the feature was broken by having TWO of it. A delegated handler near the
  # top of ui.js toggled the class and wrote `actions-collapsed`; a second implementation at
  # the bottom, from another line of work, bound its own listener to the same button, read the
  # already-toggled class and toggled it straight back. Every click undid itself a millisecond
  # later, so the rail simply did not move. Nothing in the suite noticed, because nothing asserted
  # what a click DOES — only that the button was on the page.
  #
  # So these assert the state after the click, in both directions, and that it is remembered.

  Scenario: The rail starts collapsed, because the page wants the width more than the labels do
    Given I am on "/dev"
     Then the element "#actions-rail" should be displayed
      And the element ".actions-toggle" should be displayed
      And the element "html" with the attribute "class" and the value containing "actions-collapsed" should exist
      And the element ".actions-toggle" with the attribute "aria-expanded" and the value "false" should exist

  Scenario: Clicking the toggle expands it
    Given I am on "/dev"
     When I click on the element ".actions-toggle"
     Then the element "html" with the attribute "class" and the value containing "actions-collapsed" should not exist
      And the element ".actions-toggle" with the attribute "aria-expanded" and the value "true" should exist
      And I should see "All workspaces"

  Scenario: Clicking it again collapses it — the click is not undone by a second handler
    Given I am on "/dev"
     When I click on the element ".actions-toggle"
      And I click on the element ".actions-toggle"
     Then the element "html" with the attribute "class" and the value containing "actions-collapsed" should exist
      And the element ".actions-toggle" with the attribute "aria-expanded" and the value "false" should exist

  # A layout preference that resets on every navigation is one you set on every page.
  Scenario: The choice survives a navigation
    Given I am on "/dev"
     When I click on the element ".actions-toggle"
      And I am on "/settings"
     Then the element "html" with the attribute "class" and the value containing "actions-collapsed" should not exist

  Scenario: The rail is on the settings page too, not only on a workspace page
    Given I am on "/settings"
     Then the element "#actions-rail" should be displayed
      And the element ".actions-toggle" should be displayed
