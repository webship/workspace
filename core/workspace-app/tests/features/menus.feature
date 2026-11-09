Feature: The menus on a project row
  Every project row carries its state above the name and its verbs in menus.

  Scenario: State is a strip above the folder name, not a word after it
    Given I am on "/dev"
     Then the element ".project-state" should be displayed
      And the element ".project-row .project-head" should be displayed

  Scenario: The row offers the DDEV, Graph, RAG and Tests menus
    Given I am on "/dev"
     Then the element ".project-actions" should be displayed
      And I should see "DDEV"
      And I should see "Graph"
      And I should see "RAG"
      And I should see "Tests"

  Scenario: A menu that carries a state word captions it under the button
    Given I am on "/dev"
     Then the element ".act-with-status" should be displayed
      And the element ".act-with-status .act-status" should be displayed

  # Opened on /rag rather than /dev: the rag workspace holds exactly one instance, so a click by
  # selector is unambiguous. On a page of twelve rows every selector matches twelve buttons, and a
  # test that has to say "the third one" is a test that breaks when a project is built.
  Scenario: The DDEV menu opens and holds the verbs that moved into it
    Given I am on "/dev"
      And I click on the element ".project-row >> nth=0 >> .act-menu-ddev button"
     Then ".uk-dropdown.uk-open" should be visible
      And I should see "Restart"
      And I should see "Describe (URLs, services)"
