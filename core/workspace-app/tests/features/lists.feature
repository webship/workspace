Feature: Finding things in a list
  Search, sort and paging on the lists that grow.

  Scenario: A project list carries its controls
    Given I am on "/dev"
     Then the element ".list-controls" should be displayed
      And the element ".list-search" should be displayed
      And the element "select[name='sort']" should be displayed
      And the element "select[name='per']" should be displayed

  Scenario: Searching for something absent says so
    Given I am on "/dev"
     When I fill in the field ".list-search" with "zzz-no-such-project"
      And I press the key "Enter" on the element ".list-search"
     Then I should see "No projects match"

  Scenario: The status filter offers the states a project can be in
    Given I am on "/dev"
     Then the option "Running" should exist within the select element "select[name='status']"
      And the option "Stopped" should exist within the select element "select[name='status']"
      And the option "No DDEV config" should exist within the select element "select[name='status']"
