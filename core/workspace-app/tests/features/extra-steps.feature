Feature: The Extra steps panel of a project
  A project's Tests menu opens the webship-js step packs it can add (logo, name, version, what each is for,
  its docs page) and the run picker, where the features it has, copied examples included, run one at a time.

  # The menu's items arrive when it opens (/fragments/row-menu/tests/…), so it is opened first, on the first
  # row: a page of thirteen projects has thirteen menus, and nth=0 is the one that is always there.
  @needs-project-dev
  Scenario: The Tests menu opens the Extra steps panel in the modal
    Given I am on "/dev"
     When I click on the element ".project-row >> nth=0 >> .act-menu-tests button"
     Then ".uk-dropdown.uk-open" should be visible
      And ".uk-dropdown.uk-open li[data-entry='extra steps'] a" should be attached
     When I click on the element ".uk-dropdown.uk-open li[data-entry='extra steps'] a"
     Then "#editor-modal .step-packs" should be visible
      And I should see "Extra steps for"
      And I should see "Add a pack"

  # Every pack is listed whatever the project has: npm's list, or the one shipped with the core offline.
  @needs-project-dev
  Scenario: Each pack shows its logo, its name, what it is for and its docs page
    Given I am on "/dev"
     When I click on the element ".project-row >> nth=0 >> .act-menu-tests button"
      And I click on the element ".uk-dropdown.uk-open li[data-entry='extra steps'] a"
     Then "#editor-modal .step-pack[data-pack='@webship-js/diffy-steps']" should be attached
      And "#editor-modal .step-pack[data-pack='@webship-js/wordpress-steps'] .step-pack-logo img[src='/step-packs/wordpress.svg']" should be attached
      And "#editor-modal .step-pack[data-pack='@webship-js/diffy-steps'] a.step-pack-docs[href='https://webship.co/docs/webship-js/2.0.x/diffy-step-definitions']" should be attached
      And I should see "Visual regression with Diffy screenshots and comparisons."
      And I should see "@webship-js/drupal-core-steps"

  # Add, Remove and Copy examples post to their own actions, which start cmd-tools-testing.sh in a screen:
  # asserted as the controls that exist, never clicked, so the suite changes no project.
  @needs-project-dev
  Scenario: A pack the project does not have offers Add, which runs in a screen
    Given I am on "/dev"
     When I click on the element ".project-row >> nth=0 >> .act-menu-tests button"
      And I click on the element ".uk-dropdown.uk-open li[data-entry='extra steps'] a"
     Then "#editor-modal .step-pack-list-other [hx-post='/actions/steps-add']" should be attached
      And I should see "Each runs"

  # The run picker needs a project with a suite: the menu offers it only where there is something to run.
  @needs-testing-stack
  Scenario: The run picker lists the project's features, each with Run
    Given I am on "/dev"
     When I click on the element ".project-row:has(.act-menu-tests + .act-status:text-is('ready to test')), .project-row:has(.act-menu-tests + .act-status:text-is('not ready')) >> nth=0 >> .act-menu-tests button"
     Then ".uk-dropdown.uk-open li[data-entry='run one feature'] a" should be attached
     When I click on the element ".uk-dropdown.uk-open li[data-entry='run one feature'] a"
     Then "#editor-modal .features-picker" should be visible
      And I should see "Run one feature of"
