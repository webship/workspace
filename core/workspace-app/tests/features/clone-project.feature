Feature: Cloning a project
  The clone modal validates before anything runs, and never clones over an
  existing project or a name DDEV already tracks.

  Scenario: The DDEV menu offers the clone
    Given I am on "/dev"
     Then "[hx-get^='/fragments/projects/clone-form/dev/']" should be attached

  Scenario: The form arrives prefilled, with the live check wired
    When I open the clone form of the first project in "dev"
     Then the clone form proposes a copy of that project
      And "select[name='toWorkspace']" should be attached
      And "[hx-get='/fragments/projects/clone-check']" should be attached
      And "textarea[name='prompt']" should be attached

  Scenario: The live check refuses an existing project
    When I ask the live check about the name of the first project in "dev"
     Then I should see "already exists"

  Scenario: The live check blesses a free name
    Given I am on "/fragments/projects/clone-check?to=surely-free-name-zz&toWorkspace=dev"
     Then I should see "is free"

  Scenario: Cloning over an existing project is refused server-side too
    When I post a clone of the first project in "dev" over itself
    Then the action response should contain "already exists"

  Scenario: A source that does not exist is refused
    When I post "/actions/clone-project" with '{"workspace":"dev","projectName":"no-such-src","to":"whatever-zz","toWorkspace":"dev"}'
    Then the action response should contain "Project not found"
