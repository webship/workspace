Feature: The theme
  The palette is assembled from components and a theme, and the toggle switches its halves.

  Scenario: The stylesheet is assembled, not a file on disk
    Given I am on "/style.css"
     Then I should see "/* base */"
      And I should see "/* component:"
      And I should see "/* theme:"

  Scenario: The brand mark shows exactly one of its two forms
    Given I am on "/"
     Then the element ".brand-logo-on-light" should be displayed
      And the element ".brand-logo-on-dark" should not be displayed

  Scenario: The dark half swaps the mark over
    Given I am on "/"
     When I click on the element ".theme-toggle"
     Then the element ".brand-logo-on-dark" should be displayed
      And the element ".brand-logo-on-light" should not be displayed
