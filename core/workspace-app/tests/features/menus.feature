Feature: The menus on a project row
  Every project row carries its state above the name and its verbs in menus.

  Scenario: State is a line above the folder name, not a word after it
    Given I am on "/dev"
     Then ".project-row .pcard-state-line" should be attached
      And ".project-row .pcard-head" should be attached

  # The Graph menu is the graph plugin's, asserted by its own feature.
  Scenario: The row offers the DDEV and Tests menus
    Given I am on "/dev"
     Then ".project-row .act-menu-ddev" should be attached
      And ".project-row .act-menu-tests" should be attached
      And ".project-row .act-menu-more" should be attached

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
