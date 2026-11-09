Feature: The checks a project already declares
  Every package here carries its own quality scripts. The dashboard offers them without inventing any.

  # One quality menu, not two. On a packages workspace there is no browser suite at all, and on a
  # site there was no checks control — a separate button would have been the only one present in
  # each case. They live together under Tests, with the checks nested inside it. The menu's items
  # arrive when it opens (/fragments/row-menu/tests/…), so each scenario that reads one opens the
  # first row's menu first; the caption under the button is on the page before that.
  Scenario: A package row offers its checks inside the Tests menu
    Given I am on "/products"
     Then the element ".project-row .act-menu-tests" should be displayed
      And I should see "Tests"
     When I click on the element ".project-row >> nth=0 >> .act-menu-tests button"
     Then ".uk-dropdown.uk-open" should be visible
      And ".act-menu-tests .act-menu-checks" should be attached

  Scenario: The button says what the package covers without running anything
    Given I am on "/products"
     Then the element ".act-menu-tests + .act-status" should be displayed
     When I click on the element ".project-row >> nth=0 >> .act-menu-tests button"
     Then "[hx-post='/actions/checks-plan']" should be attached

  # The pair is the point: the canonical name is what you type (--only js), the code beside it is
  # the script the package itself declared. Listing them together is how the mapping is checkable.
  # Opened on a row whose caption says the package declares checks, since a package that declares
  # none lists none.
  Scenario: The nested menu lists each alias against the script it runs
    Given I am on "/products"
     When I click on the element ".project-row:has(.act-menu-tests + .act-status:has-text('declared')), .project-row:has(.act-menu-tests + .act-status:has-text('deps missing')), .project-row:has(.act-menu-tests + .act-status:has-text('passed')), .project-row:has(.act-menu-tests + .act-status:has-text('failed')) >> nth=0 >> .act-menu-tests button"
     Then ".uk-dropdown.uk-open" should be visible
      And ".checks-sub" should be attached
      And ".checks-sub .checks-alias" should be attached
      And ".checks-sub .checks-script" should be attached

  # Opened on a row whose caption says its checks are declared with their dependencies there — the
  # alias control renders only for an alias that is READY, and "deps missing" says none is.
  @needs-check-aliases
  Scenario: Each alias can be run on its own, and so can all of them
    Given I am on "/products"
     When I click on the element ".project-row:has(.act-menu-tests + .act-status:has-text('declared')), .project-row:has(.act-menu-tests + .act-status:has-text('passed')), .project-row:has(.act-menu-tests + .act-status:has-text('failed')) >> nth=0 >> .act-menu-tests button"
     Then ".uk-dropdown.uk-open" should be visible
      And "[hx-post='/actions/checks']" should be attached
      And "[hx-vals*='only']" should be attached

  # A site gets the same nested list: its package.json declares the same vocabulary, and its
  # ddev-dev-tools add-on adds the PHP and Twig checks on top. Opened on a row whose caption says a
  # stack is there, since "Run the tests" is only offered where there is a suite to run.
  @needs-testing-stack
  Scenario: A site keeps its testing verbs and gains the checks beside them
    Given I am on "/dev"
     Then the element ".project-row .act-menu-tests" should be displayed
     When I click on the element ".project-row:has(.act-menu-tests + .act-status:text-is('ready to test')), .project-row:has(.act-menu-tests + .act-status:text-is('not ready')), .project-row:has(.act-menu-tests + .act-status:text-is('running now')) >> nth=0 >> .act-menu-tests button"
     Then ".uk-dropdown.uk-open" should be visible
      And "[hx-post='/actions/testing-configure']" should be attached
      And "[hx-post='/actions/testing-run']" should be attached
      And ".act-menu-tests .act-menu-checks" should be attached
