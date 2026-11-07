Feature: Settings → Plugins
  Optional features are packages, turned on in four steps; the page shows every package the
  dashboard can see and the step each is at.

  Scenario: The Plugins page lists the packages with their steps
    Given I am on "/settings/plugins"
     Then I should see "Plugins"
      And the element ".plugin-card" should be displayed
      And the element ".plugin-steps" should be displayed
      And I should see "required"
      And I should see "configured"

  Scenario: A package can be required from the page
    Given I am on "/settings/plugins"
     Then the element ".plugin-require input[name=spec]" should be displayed
      And I should see "Require"

  Scenario: Settings offers Plugins among the dashboard's own sections
    Given I am on "/settings"
     Then I should see "Plugins"
