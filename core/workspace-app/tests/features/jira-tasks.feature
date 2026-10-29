Feature: Jira tasks on the project rows
  A sites workspace project row offers its Jira surface, and the actions hold
  their guards without ever needing Jira to answer.

  # The menu is gated on twg + settings; in this environment both hold, so the
  # rows carry the menu and the modal link.
  Scenario: The JIRA menu is on the project rows
    Given I am on "/dev"
     Then "[hx-get^='/fragments/projects/jira/dev/']" should be attached

  # The guards answer without Jira: a malformed key never reaches twg.
  Scenario: A malformed key is refused at the door
    When I post "/actions/jira-task" with '{"workspace":"dev","projectName":"v11x00b1i18n","key":"not-a-key","mode":"view"}'
    Then the action response should contain "Not a Jira key"

  @needs-jira-writes-off
  Scenario: Write modes are refused while Jira writes are off
    When I post "/actions/jira-task" with '{"workspace":"dev","projectName":"v11x00b1i18n","key":"WEBSHIP-1","mode":"comment"}'
    Then the action response should contain "Writing to Jira is off"

  Scenario: An unknown project cannot host an agent
    When I post "/actions/jira-task" with '{"workspace":"dev","projectName":"no-such-project","key":"WEBSHIP-1","mode":"view"}'
    Then the action response should contain "Project not found"

  Scenario: Watching a task nobody worked on says so
    When I post "/actions/jira-task" with '{"workspace":"dev","projectName":"v11x00b1i18n","key":"WEBSHIP-424242","mode":"watch"}'
    Then the action response should contain "No agent log"

  Scenario: The Screens modal lists sessions or says there are none
    Given I am on "/fragments/screens"
     Then I should see "Screen sessions"

  Scenario: Stopping a screen needs confirmation
    When I post "/actions/screen-stop" with '{"session":"whatever-zz"}'
    Then the action response should contain "requires confirmation"

  Scenario: A hostile session name is refused
    When I post "/actions/screen-stop" with '{"session":"x; rm -rf /","confirm":"yes"}'
    Then the action response should contain "Not a screen session name"

  Scenario: Remembering a Jira project refuses a bad key
    When I post "/actions/jira-set-project" with '{"workspace":"dev","projectName":"v11x00b1i18n","key":"bad-key-1"}'
    Then the action response should contain "Not a Jira project key"

  Scenario: Remembering needs a real project
    When I post "/actions/jira-set-project" with '{"workspace":"dev","projectName":"no-such","key":"WEBSHIP"}'
    Then the action response should contain "Project not found"
