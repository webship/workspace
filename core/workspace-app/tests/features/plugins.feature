Feature: Settings → Plugins
  Optional features are packages, turned on in four steps. Settings shows the ones that are here by
  family, each on a page of its own; the Plugins page is where one is added.

  Scenario: The Plugins page is the catalogue, by family
    Given I am on "/settings/plugins"
     Then I should see "Add a plugin"
      And I should see "Catalogue"
      And the element ".plugin-catalog .plugin-row" should be displayed
      And I should see "Platforms"
      And I should see "Hosting providers"

  Scenario: A package can be required from the page
    Given I am on "/settings/plugins"
     Then the element ".plugin-require input[name=spec]" should be displayed
      And I should see "Add a package by name"

  Scenario: The catalogue has a filter
    Given I am on "/settings/plugins"
     Then the element "#settings-search-input" should be displayed
     When I fill in "settings-search-input" with "upsun" by its "id" attribute
     Then I should see "1 plugin shown."

  Scenario: Settings offers Plugins and the way to add one
    Given I am on "/settings"
     Then I should see "Plugins"
      And "a[href='/settings/plugins']" should be attached

  # workspace-notes is the reference plugin the base carries, so it is on every dashboard.
  Scenario: A plugin has a page of its own, with the four steps as one list
    Given I am on "/settings/plugin/workspace-notes"
     Then the element ".plugin-head-name" should be displayed
      # The list, while a step is left; folded under "Turned on" once every step is done (the base's own
      # workspace-notes is on in a checkout of the repository): there either way.
      And "ol.plugin-step-list" should be attached
      And I should see "What it needs"
      And I should see "What it ships"
      And I should see "Reinstall or remove"

  Scenario: The Settings home lists it as a row with its state in words
    Given I am on "/settings"
     Then "a[href='/settings/plugin/workspace-notes']" should be attached
      And the element ".plugin-row .plugin-state" should be displayed

  Scenario: A plugin that is not here says so, and where to add it
    Given I am on "/settings/plugin/no-such-plugin"
     Then I should see "No plugin called no-such-plugin is added to this workspace"
      And "a[href='/settings/plugins']" should be attached

  Scenario: The filter of the Settings home says when nothing matches
    Given I am on "/settings"
     When I fill in "settings-search-input" with "zzzz-nothing-has-this-name" by its "id" attribute
     Then I should see "Nothing matches."
