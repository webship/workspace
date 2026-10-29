Feature: Writing and changing the workspace commands
  A cmd-*.sh is executed by the dashboard and by a terminal, so nothing changes one unreviewed.

  Scenario: A new command can be given a purpose, not just a name
    Given I am on "/settings/commands"
     Then I should see "New command"

  # The scaffold alone is a correct command that does nothing. Saying what it is FOR is what makes it
  # a command for that thing — the assistant reads the workspace's own conventions and writes it.
  Scenario: The new-command form asks what the command should do
    Given I am on "/fragments/commands/new"
     Then "textarea[name='purpose']" should be attached
      And "input[name='newName']" should be attached
      And "select[name='target']" should be attached

  Scenario: The editor offers the assistant a change to make
    Given I am on "/fragments/commands/edit/dev/cmd-tools-checks.sh"
     Then "textarea[name='instruction']" should be attached
      And ".cmd-ai-row .field-mic" should be attached
      And "[hx-post='/actions/command-ai']" should be attached
      And I should see "Ask"

  # The command is still what gets saved by hand: the assistant is an extra way in, not the only one.
  Scenario: The editor still edits the command directly
    Given I am on "/fragments/commands/edit/dev/cmd-tools-checks.sh"
     Then "textarea[name='content']" should be attached
      And "[hx-post='/actions/command-save']" should be attached
      And I should see "bash -n"

  # 239 commands is too many to scroll. Searching matches the file name, the human name AND the
  # description, because "reclaim" and "back up" are what somebody types and neither is a file name.
  # A file name is a string you are about to type. In the body font it reads as prose and loses its
  # word boundaries, and cmd-tool-backup-product.sh has a lot of boundaries.
  Scenario: File names are shown as code wherever they appear
    Given I am on "/fragments/commands/edit/dev/cmd-tools-checks.sh"
     Then "h3 code.fname" should be attached
      And "p code.fname" should be attached

  Scenario: Commands can be searched and narrowed to one workspace folder
    Given I am on "/settings/commands"
     Then "input[name='q']" should be attached
      And "select[name='ws']" should be attached
      And ".cmd-title" should be attached
      And ".cmd-file" should be attached

  # Every list in the app 500d the moment `auto` reached the query, which is the first click of the
  # auto-search checkbox: lists.js called hubDomain() without importing it.
  Scenario: A list survives the auto-search preference being sent
    Given I am on "/fragments/commands/list?q=backup&ws=all&auto=0&page=1"
     Then ".cmd-title" should be attached

  # Six action buttons and a full sentence on the same line squeezed each other into two-word
  # columns. What a command is reads first; what you can do to it follows underneath.
  Scenario: A command row reads top to bottom, with its actions on their own line
    Given I am on "/settings/commands"
     Then ".cmd-row-stack" should be attached
      And ".cmd-row-stack .cmd-id" should be attached
      And ".cmd-row-stack .project-actions" should be attached
