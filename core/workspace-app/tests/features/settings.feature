Feature: The settings editor
  The one page that holds real credentials, so what it does NOT show matters as much as what it does.

  Scenario: The editor lists the settings files and edits one at a time
    Given I am on "/settings/settings.yml"
     Then the element ".settings-tabs" should be displayed
      And I should see "settings.yml"
      And I should see "Workspace name"

  # A secret's value never reaches the browser: the field renders empty with a note saying a blank
  # submission keeps what is on disk. This asserts the mechanism rather than the absence of one
  # particular string, which would pass on a page that simply failed to render.
  # The note lives in the field's placeholder, not in the page text: it belongs to the box you are
  # about to type in, and as body copy it would repeat itself once per secret on the page.
  Scenario: A secret is offered as a field to replace, never as a value to read
    Given I am on "/settings/settings.yml"
     Then the element "input[type='password']" should be displayed
      And the element "input[type='password']" with the attribute "placeholder" and the value containing "leave blank to keep" should exist
      And the element "input[type='password']" with the attribute "value" and the value containing "-" should not exist

  # account.pass is deliberately NOT a secret: it is the admin password a fresh local install is
  # given, and masking it made the field useless for the one thing it is for.
  Scenario: The local admin password stays readable, because that is what it is for
    Given I am on "/settings/settings.yml"
     Then I should see "pass"
      And I should see "That admin password"

  Scenario: A workspace has its own settings file with its card presentation in it
    Given I am on "/settings/workspace.rag.settings.yml"
     Then I should see "presentation"
      And the element "#ws-presentation" should be displayed

  # The icon chooser writes only the two fields it owns. The rest of the block — label, noun, kind,
  # also_files — has to still be there afterwards, which is what the unit tests assert; here we
  # assert the chooser is what the page offers rather than a free-text field.
  Scenario: The icon is chosen from the icons that will actually render
    Given I am on "/settings/workspace.rag.settings.yml"
     Then the element ".icon-filter" should be displayed
      And the element ".icon-grid" should be displayed

  Scenario: The settings home shows the base first, then the plugins by family
    Given I am on "/settings"
     Then I should see "Workspace base"
      And I should see "Plugins"
      And "a[href='/settings/settings.yml']" should be attached
      And "a[href='/settings/styles']" should be attached
      And the element "a" with the attribute "href" and the value "/settings/theme.default.yml" should not exist
      And "a[href='/settings/plugins']" should be attached

  # The filter is drawn hidden and shown by the page's script: a page whose script did not run offers
  # no box that does nothing.
  Scenario: The settings home has one filter over the base and the plugins
    Given I am on "/settings"
     Then the element "#settings-search-input" should be displayed
      And the element ".settings-chip[data-show='attention']" should be displayed

