Feature: The menus on a project row
  Every row offers DDEV, its graph, its index and the rest — and each reports real state.

  Scenario: A project row carries all four menus
    Given I am on "/dev"
     Then I should see "DDEV"
      And I should see "Graph"
      And I should see "RAG"
      And I should see "More"

  Scenario: The DDEV menu opens and offers the verbs
    Given I am on "/dev"
     When I click on the element ".project-row .act-menu button"
     Then I should see "Restart"
      And I should see "Describe"
      And I should see "Web logs"
