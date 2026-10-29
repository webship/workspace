Feature: The checks a project already declares
  Every package here carries its own quality scripts. The dashboard offers them without inventing any.

  # One quality menu, not two. On a packages workspace there is no browser suite at all, and on a
  # site there was no checks control — a separate button would have been the only one present in
  # each case. They live together under Tests, with the checks nested inside it.
  Scenario: A package row offers its checks inside the Tests menu
    Given I am on "/products"
     Then the element ".project-row .act-menu-tests" should be displayed
      And ".act-menu-tests .act-menu-checks" should be attached
      And I should see "Tests"

  Scenario: The button says what the package covers without running anything
    Given I am on "/products"
     Then the element ".act-menu-tests + .act-status" should be displayed
      And "[hx-post='/actions/checks-plan']" should be attached

  # The pair is the point: the canonical name is what you type (--only js), the code beside it is
  # the script the package itself declared. Listing them together is how the mapping is checkable.
  Scenario: The nested menu lists each alias against the script it runs
    Given I am on "/products"
     Then ".checks-sub" should be attached
      And ".checks-sub .checks-alias" should be attached
      And ".checks-sub .checks-script" should be attached

  @needs-check-aliases
  Scenario: Each alias can be run on its own, and so can all of them
    Given I am on "/products"
     Then "[hx-post='/actions/checks']" should be attached
      And "[hx-vals*='only']" should be attached

  # A site gets the same nested list: its package.json declares the same vocabulary, and its
  # ddev-dev-tools add-on adds the PHP and Twig checks on top.
  Scenario: A site keeps its testing verbs and gains the checks beside them
    Given I am on "/dev"
     Then the element ".project-row .act-menu-tests" should be displayed
      And "[hx-post='/actions/testing-configure']" should be attached
      And "[hx-post='/actions/testing-run']" should be attached
      And ".act-menu-tests .act-menu-checks" should be attached
