Feature: A site built on Kubernetes is a first-class project
  A site built with --runtime kubernetes has the row a DDEV project has: its state, its own address, and a K8S menu
  where the DDEV menu sits. Start and stop go through the Workspace's runtime layer, and the Tests menu is offered.

  # Each scenario drives a real, running site on Kubernetes (a local kind cluster, or the cluster of the context
  # WORKSPACE_KUBE_CONTEXT names): the first one the workspace holds. Without one, or without a cluster that
  # answers, it is skipped with the reason (@needs-runtime-kubernetes).

  @needs-runtime-kubernetes
  Scenario: The row of a Kubernetes site shows Running and the address of its NodePort
    Given I am on the folder of the "kubernetes" site
     Then the row of the "kubernetes" site should show "Running"
      And the row of the "kubernetes" site should link to the address of its runtime
      And the address of the "kubernetes" site should answer

  @needs-runtime-kubernetes
  Scenario: The K8S menu sits where the DDEV menu does, and lists its entries
    Given I am on the folder of the "kubernetes" site
     Then the row of the "kubernetes" site should carry the "K8S" menu and no DDEV menu
     When I open the "runtime" menu of the "kubernetes" site
     Then the open menu should offer "Stop"
      And the open menu should offer "Restart"
      And the open menu should offer "Describe"
      And the open menu should offer "Web logs"
      And the open menu should offer "Shell in the web container"
      And the open menu should offer "Open the site"
      And the open menu should offer "Delete the namespace"
      And the open menu should not offer "Start"
      And the open menu should say "Not on Kubernetes yet"

  @needs-runtime-kubernetes
  Scenario: Stop and start change the badge, with no reload
    Given I am on the folder of the "kubernetes" site
     When I open the "runtime" menu of the "kubernetes" site
      And I choose "Stop" in the open menu
     Then the row of the "kubernetes" site should show "Stopped" within 180 seconds
     When I open the "runtime" menu of the "kubernetes" site
     Then the open menu should not offer "Shell in the web container"
     When I choose "Start" in the open menu
     Then the row of the "kubernetes" site should show "Running" within 300 seconds
      And the address of the "kubernetes" site should answer

  @needs-runtime-kubernetes
  Scenario: The Tests menu is offered on a Kubernetes site
    Given I am on the folder of the "kubernetes" site
     When I open the "tests" menu of the "kubernetes" site
     Then "[hx-post='/actions/testing-configure']" should be attached
