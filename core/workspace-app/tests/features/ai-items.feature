Feature: Installing agents, skills and prompts

  Scenario: An item can be installed into the global Claude Code, or into one project
    Given I am on "/ai-agents"
     Then "select[name='toWorkspace']" should be attached
      And "select[name='toProject']" should be attached
      And "[hx-post='/actions/install-item']" should be attached

  # htmx 4 fires after:swap on the element that MADE the request, not on the one
  # swapped — so a listener reading e.target saw the button and never opened the
  # modal. The content had loaded; nothing appeared.
  Scenario: Editing a prompt opens the editor with its text in it
    Given I am on "/ai-prompts"
     When I click on the element "[hx-get^='/fragments/ai-prompts/edit/'] >> nth=0"
     Then "#editor-modal.uk-open" should be visible
      And "#editor-modal .ace_editor" should be visible
      And "#editor-modal form[hx-post='/actions/save-item']" should be attached

  Scenario: The same Edit works on the agents workspace
    Given I am on "/ai-agents"
     When I click on the element "[hx-get^='/fragments/ai-agents/edit/'] >> nth=0"
     Then "#editor-modal.uk-open" should be visible
      And "#editor-modal .ace_editor" should be visible
