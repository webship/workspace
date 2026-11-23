Feature: The dashboard itself on a plain address
  The dashboard runs in its DDEV project, on Docker Compose or on Kubernetes. Outside DDEV it has no
  workspace.ddev.site: it answers on a port of this machine, on a node of the cluster, or on a domain put in front
  of it. Its pages, its links and its terminals belong to that address.

  # Each scenario needs a dashboard asked on an address that is not the hub (node on a port, Docker Compose,
  # Kubernetes). On the hub it is skipped with the reason (@needs-plain-address).

  @needs-plain-address
  Scenario: The pages name the address they are on, not the hub
    Given I am on "/"
     Then the footer should name the address of this dashboard
      And no link of the page should lead to the hub

  @needs-plain-address
  Scenario: Settings and Screens open on that address
    Given I am on "/settings"
     Then I should see "Settings"
     When I go to "/screens"
     Then I should see "Screens"
      And no link of the page should lead to the hub

  @needs-plain-address
  Scenario: A name the dashboard is not known by is refused
     When I ask the dashboard under the name "rebound.example.org"
     Then it should refuse with 403

  @needs-plain-address
  Scenario: A preference is kept on that address
    Given I am on "/"
     When I keep the preference "ws-proof" as "plain"
      And I reload the page
     Then the preference "ws-proof" should be "plain" in the cookies of this address

  # What the palette goes to is this address's own (#759): a workspace folder is a page of this dashboard, the way its
  # card is, where it used to be the hub's. A workspace with no folder yet (a fresh one) has none to go to, and the
  # scenario is skipped there with the reason. (The folder's page itself is not asked for links to the hub here: a
  # DDEV project's Launch on it still leads there, #764.)
  @needs-plain-address
  Scenario: The palette opens a workspace folder on that address
    Given I am on "/"
     When I choose the first workspace folder in the palette
     Then I should be on that folder's page of this dashboard
      And the footer should name the address of this dashboard
