Feature: The Screens manager
  Screen sessions are where long work lives — Jira agents, builds, anything
  started with cmd-tools-screen.sh. The page must list them, refuse what would
  reach a shell, and never let another site drive it.

  Scenario: Screens is its own page, not a settings tab
    Given I am on "/screens"
     Then I should see "New screen"
      And I should see "Wipe dead"

  Scenario: The old settings URL still lands on the manager
    Given I am on "/settings/screens"
     Then I should see "New screen"

  Scenario: A new session needs a place that the server offered
    When I post "/actions/screen-new" with '{"session":"zz-nope","target":"/etc"}'
    Then the action response should contain "Unknown place"

  Scenario: A session name that screen would read as an option is refused
    When I post "/actions/screen-new" with '{"session":"-S","target":"root"}'
    Then the action response should contain "session name"

  Scenario: Killing a session is refused without confirmation
    When I post "/actions/screen-stop" with '{"session":"whatever-zz"}'
    Then the action response should contain "requires confirmation"

  Scenario: A hostile session name never reaches screen
    When I post "/actions/screen-interrupt" with '{"session":"x; rm -rf /"}'
    Then the action response should contain "Not a screen session name"
