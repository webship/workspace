Feature: A project's row after a build
  A build started from a folder's Build form runs in a screen session. The page hears when the session ends, reads the
  states again and draws the rows, so the project's row shows the state the build left, with no reload (#894). It used
  to reload once as the build's notice left, at the start of the build, and keep the state it read then.

  # The builder makes a small site on Docker Compose (sandboxes/cmd-ci-row-project.sh, which CI places beside the
  # other builders), so the row has a real state to show. Where the folder has no such builder it is skipped, with the
  # reason.
  @needs-builder-ci-row
  Scenario: The row of a site built from the Build form says Running once the build ends, with no reload
    Given I am on "/sandboxes"
     When I build "ci-row" with the builder "cmd-ci-row-project.sh"
     Then the row of the project "ci-row" should show "Running" within 180 seconds
      And the page should not have been reloaded since the build started
