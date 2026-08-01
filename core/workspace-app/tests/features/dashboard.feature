Feature: The workspace dashboard
  The pages a person opens every day, asserted against the running site.

  Scenario: The hub lists the workspaces
    Given I am on "/"
     Then the element "#workspace-cards" should be displayed
      And the element ".ws-card-wrap" should be displayed
      And I should see "Products"
      And I should see "Dev"

  Scenario: A card carries the handle that reorders it, inside the card
    Given I am on "/"
     Then the element ".ws-card-inner" should be displayed
      And the element ".ws-card-wrap .ws-card-handle" should be displayed
      And the element "#workspace-cards" with the attribute "uk-sortable" and the value containing "ws-card-handle" should exist

  Scenario: The settings page offers the theme and the assistant
    Given I am on "/settings"
     Then I should see "theme"
      And I should see "workspace_name"
      And I should see "voice_input"
      And the element "select" should be displayed

  Scenario: A workspace settings page offers the icon picker and its search
    Given I am on "/settings/workspace.dev.settings.yml"
     Then the element "#ws-presentation" should be displayed
      And the element ".icon-filter" should be displayed
      And the element ".pres-preview" should be displayed
