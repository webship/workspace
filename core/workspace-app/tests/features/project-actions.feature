Feature: What a project row can actually do
  The verbs on a row, asserted where they are rather than by opening every menu.

  # Each menu carries the name of the verb it opens (act-menu-ddev, act-menu-tests, …). A page of
  # thirteen projects has thirteen of each, so these assert that the control and its items EXIST
  # rather than clicking one — a test that has to say "the third one" breaks the moment a project
  # is built. The one click test lives on /rag, which holds exactly one row.

  Scenario: A row carries a menu for each thing it can do
    Given I am on "/dev"
     Then the element ".project-row .act-menu-ddev" should be displayed
      And the element ".project-row .act-menu-tests" should be displayed
      And the element ".project-row .act-menu-graph" should be displayed
      And the element ".project-row .act-menu-more" should be displayed

  # These two are the whole testing feature as far as the interface is concerned: one sets the
  # environment up, the other runs the suite. Both post to their own action.
  Scenario: The Tests menu offers setting the environment up and running the suite
    Given I am on "/dev"
     Then "[hx-post='/actions/testing-configure']" should be attached
      And "[hx-post='/actions/testing-run']" should be attached

  # The state under the button is the answer to "is there anything to look at yet" — it says
  # webship, webship-js or none, and it is a caption under the control rather than a word inside it.
  Scenario: A menu that carries a state word captions it under the button
    Given I am on "/dev"
     Then the element ".act-with-status .act-status" should be displayed

  Scenario: The DDEV menu opens and holds the verbs that moved into it
    Given I am on "/rag"
     When I click on the element ".project-row .act-menu-ddev button"
     Then ".uk-dropdown.uk-open" should be visible
      And I should see "Restart"
      And I should see "Describe (URLs, services)"

  # Launch belongs with the hostname it opens, not in the row of things you DO to a project.
  Scenario: A running project offers its own URL beside the Launch button
    Given I am on "/dev"
     Then the element ".proj-launch-line" should be displayed
      And the element ".proj-launch-line .proj-alias" should be displayed
