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
      And I should see "Require a package by name"

  Scenario: The catalogue has a filter
    Given I am on "/settings/plugins"
     Then the element "#settings-search-input" should be displayed
     When I fill in "settings-search-input" with "upsun" by its "id" attribute
     Then I should see "1 plugin shown."

  Scenario: Settings offers Plugins and the way to add one
    Given I am on "/settings"
     Then I should see "Plugins"
      And "a[href='/settings/plugins']" should be attached
