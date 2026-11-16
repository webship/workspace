Feature: The menus on a project row
  Every project row carries its state above the name and its verbs in menus.

  @needs-project-dev
  Scenario: State is a line above the folder name, not a word after it
    Given I am on "/dev"
     Then ".project-row .pcard-state-line" should be attached
      And ".project-row .pcard-head" should be attached

  # The Graph menu is the graph plugin's, asserted by its own feature.
  @needs-project-dev
  Scenario: The row offers the DDEV and Tests menus
    Given I am on "/dev"
     Then ".project-row .act-menu-ddev" should be attached
      And ".project-row .act-menu-tests" should be attached
      And ".project-row .act-menu-more" should be attached

  @needs-project-dev
  Scenario: A menu that carries a state word captions it under the button
    Given I am on "/dev"
     Then the element ".act-with-status" should be displayed
      And the element ".act-with-status .act-status" should be displayed

  # Opened on /rag rather than /dev: the rag workspace holds exactly one instance, so a click by
  # selector is unambiguous. On a page of twelve rows every selector matches twelve buttons, and a
  # test that has to say "the third one" is a test that breaks when a project is built.
  @needs-project-dev
  Scenario: The DDEV menu opens and holds the verbs that moved into it
    Given I am on "/dev"
      And I click on the element ".project-row >> nth=0 >> .act-menu-ddev button"
     Then ".uk-dropdown.uk-open" should be visible
      And I should see "Restart"
      And I should see "Describe (URLs, services)"

  # Escape closes the menu and gives focus back to the button that opened it; it used to fall to the page.
  @needs-project-dev
  Scenario: Escape closes a row menu and gives focus back to its button
    Given I am on "/dev"
     When I focus on the element ".project-row >> nth=0 >> .act-menu-ddev button"
      And I press the key "Enter"
     Then ".uk-dropdown.uk-open" should be visible
     When I wait 1 second
      And I press the key "Tab"
      And I press the key "Escape"
      And I wait 1 second
     Then ".uk-dropdown.uk-open" should not be visible
      And the focused element should match ".act-menu-ddev button"
