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

  # On a laptop with the assistant open beside the page there is no room for the rail's labels as well: at
  # 1024 the Dev page's build form was cut to a 281px card. There the rail starts collapsed, opens over the
  # content when asked, and closes on Escape or on a click outside it; opening it there is not remembered.
  Scenario: With the assistant beside the page on a laptop, the rail opens over the content and closes on Escape
    Given I am on "/dev"
      And the local storage "ws-assistant-open" is set to "1"
      And the local storage "ws-assistant-view" is set to "sidebar"
      And the local storage "actions-collapsed" is set to "0"
     When I set the viewport to 1280 by 800
      And I reload the page
     Then the element "html" with the attribute "class" and the value containing "actions-collapsed" should exist
     When I click on the element ".actions-toggle"
     Then the element ".actions-toggle" with the attribute "aria-expanded" and the value "true" should exist
     When I press the key "Escape"
     Then the element ".actions-toggle" with the attribute "aria-expanded" and the value "false" should exist
      And ".actions-toggle" should be focused
     When I click on the element ".actions-toggle"
      And I click on the element "main h1"
     Then the element ".actions-toggle" with the attribute "aria-expanded" and the value "false" should exist
