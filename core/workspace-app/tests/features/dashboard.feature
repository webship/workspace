Feature: The workspace dashboard
  The pages a person opens every day, asserted against the running site.

  Scenario: The hub lists the workspaces
    Given I am on "/"
     Then the element "#workspace-cards" should be displayed
      And the element ".ws-card-wrap" should be displayed
      And I should see "Products"
      And I should see "Dev"
      And I should see "RAG"

  Scenario: A card carries the handle that reorders it
    Given I am on "/"
     Then the element ".ws-card-handle" should be displayed
      And the element "#workspace-cards" with the attribute "data-sortable" and the value containing "ws-card-wrap" should exist

  Scenario: A workspace page offers its builder and its projects
    Given I am on "/dev"
     Then I should see "Build a new project"
      And the element ".project-row" should be displayed
      And the element "select" should be displayed

  Scenario: The settings page is reachable and shows the style block
    Given I am on "/settings"
     Then I should see "Workspace name"
      And I should see "theme"

  Scenario: The assistant panel is on the page it belongs to
    Given I am on "/"
     Then I should see "AI Assistant"

  # It is ONE assistant, whose conversation follows you between workspaces — the thread id is a
  # cookie on the hub domain for exactly that reason. The panel used to prefix the workspace it was
  # scoped to ("Dev AI Assistant"), which read as a different assistant on every page. The scope is
  # still shown, where it belongs: in the command picker, which carries that workspace's commands.
  Scenario: The assistant is called the same thing on a workspace page
    Given I am on "/dev"
     Then I should see "AI Assistant"
      And I should not see "Dev AI Assistant"
      And I should see "the agent decides (Dev)"

  # What it is called is configuration: `assistant: name:` in settings.yml for the dashboard, and in
  # a workspace's own file for that workspace's page. Shipped, both say AI Assistant.
  Scenario: Its name comes from the settings file, where anyone can change it
    Given I am on "/settings/settings.yml"
     Then I should see "What the assistant is called"
      And I should see "What the box says when it is empty"

  Scenario: A workspace with no projects still renders its page
    Given I am on "/projects"
     Then I should see "Projects"
      And "#webship-workspace-projects" should be attached

  Scenario: The assistant is a deep-chat component with its own input
    Given I am on "/"
     Then "#ws-deep-chat" should be attached
      And "deep-chat" should be attached
