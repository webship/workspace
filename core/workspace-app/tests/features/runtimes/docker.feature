Feature: A site built on Docker Compose is a first-class project
  A site built with --runtime docker has the row a DDEV project has: its state, its own address, and a DOCKER menu
  where the DDEV menu sits. Start and stop go through the Workspace's runtime layer, and the Tests menu is offered.

  # Each scenario drives a real, running site on Docker Compose: the first one the workspace holds. Without one it
  # is skipped with the reason (@needs-runtime-docker).

  @needs-runtime-docker
  Scenario: The row of a Docker site shows Running and its own address
    Given I am on the folder of the "docker" site
     Then the row of the "docker" site should show "Running"
      And the row of the "docker" site should link to the address of its runtime
      And the address of the "docker" site should answer

  @needs-runtime-docker
  Scenario: The DOCKER menu sits where the DDEV menu does, and lists its entries
    Given I am on the folder of the "docker" site
     Then the row of the "docker" site should carry the "DOCKER" menu and no DDEV menu
     When I open the "runtime" menu of the "docker" site
     Then the open menu should offer "Stop"
      And the open menu should offer "Restart"
      And the open menu should offer "Describe"
      And the open menu should offer "Web logs"
      And the open menu should offer "Shell in the web container"
      And the open menu should offer "Open the site"
      And the open menu should offer "Delete the containers"
      And the open menu should not offer "Start"
      And the open menu should say "Not on Docker Compose yet"

  @needs-runtime-docker
  Scenario: Stop and start change the badge, with no reload
    Given I am on the folder of the "docker" site
     When I open the "runtime" menu of the "docker" site
      And I choose "Stop" in the open menu
     Then the row of the "docker" site should show "Stopped" within 180 seconds
     When I open the "runtime" menu of the "docker" site
     Then the open menu should not offer "Shell in the web container"
     When I choose "Start" in the open menu
     Then the row of the "docker" site should show "Running" within 300 seconds
      And the address of the "docker" site should answer

  @needs-runtime-docker
  Scenario: The Tests menu is offered on a Docker site
    Given I am on the folder of the "docker" site
     When I open the "tests" menu of the "docker" site
     Then "[hx-post='/actions/testing-configure']" should be attached
