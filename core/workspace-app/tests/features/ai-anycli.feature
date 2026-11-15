Feature: Sources and AI CLIs
  An ai-* folder takes its items from more than one repository and installs each one into any AI CLI
  the settings list. The panel is the terminal's own command with buttons on it.

  Scenario: The panel opens from the rail of an AI items page
    Given I am on "/ai-skills"
     When I click on the element "[hx-get='/fragments/ai-skills/any-cli']"
     Then the element "#any-cli-panel" should be displayed
      And I should see "Sources and AI CLIs"
      And the element ".any-cli-add input[name='source']" should be displayed

  Scenario: The AI CLIs of the settings are listed with their states
    Given I am on "/ai-skills"
     When I click on the element "[hx-get='/fragments/ai-skills/any-cli']"
     Then the element ".any-cli-chip[data-cli='claude']" should be displayed
      And the element ".any-cli-chip[data-cli='gemini']" should be displayed
      And I should see "core/config/ai.settings.yml"

  Scenario: A source that is not an https address of a repository is refused, and said
    Given I am on "/ai-skills"
     When I click on the element "[hx-get='/fragments/ai-skills/any-cli']"
      And I fill in the field ".any-cli-add input[name='source']" with "http://example.com/a/b"
      And I click on the element ".any-cli-add button[type='submit']"
     Then I should see "Not a source I can read"
