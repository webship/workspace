Feature: The report a test run leaves behind
  A finished run is readable in the dashboard and downloadable as a document.

  # The report opens in a modal from the Tests menu, so the row links to the FRAGMENT that renders
  # it. Asserted on the fragment itself rather than by opening thirteen menus to find one.
  @needs-test-report
  Scenario: The Tests menu links to the report of a project that has been tested
    Given I am on "/dev"
     Then "[hx-get^='/fragments/dev/test-report/']" should be attached

  @needs-test-report
  Scenario: The report offers itself as a PDF, for people who were not at the run
    Given I am on "/fragments/dev/test-report/amd-website_starter-1-0-x-site-template-manager"
     Then I should see "Download as PDF"
      And "[href^='/report-pdf/dev/']" should be attached

  # Not navigated to: the route answers with Content-Disposition: attachment, which a browser
  # downloads rather than renders — so the PDF itself is asserted by the unit tests, which check
  # the document it builds. This checks the interface offers it.
  @needs-test-report
  Scenario: The report leads with the counts, not with a list to scroll
    Given I am on "/fragments/dev/test-report/amd-website_starter-1-0-x-site-template-manager"
     Then I should see "passed"
      And I should see "failed"
      And I should see "scenarios"
      And the element ".uk-label-success" should be displayed
      And the element ".uk-label-danger" should be displayed

  @needs-test-report
  Scenario: The HTML report is reachable from it as well
    Given I am on "/fragments/dev/test-report/amd-website_starter-1-0-x-site-template-manager"
     Then I should see "Open the HTML report"
