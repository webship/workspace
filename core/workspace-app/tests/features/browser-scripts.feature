Feature: The page's own scripts do their work in a browser
  The scripts the pages load are built from TypeScript sources (src/browser) into public/. A unit test proves a built
  file is what its source builds to; this proves the built files still do their work in a real browser: the spoken
  summary of an answer, the keyboard reorder of the home page's cards, and the player's speed and loop buttons.

  Scenario: The spoken summary of an answer leaves the code out
    Given I am on "/"
     Then the spoken summary of "<p>Built it. The site runs.</p><pre>start it</pre><p>A third one.</p>" should be "Built it. The site runs."
      And the voice chosen from "Plain voice, Neural voice" should be "Neural voice"
      And there should be no JavaScript errors

  # It saves the order of the home page's cards, so it runs only on a dashboard of its own (node on a port, a
  # container, a cluster), never on one that serves somebody's workspace, and it puts the order back at the end.
  @needs-plain-address
  Scenario: A card moves with Alt and an arrow key, and keeps its place after a reload
    Given I am on "/"
     When I move the first workspace card one place on with the keyboard
     Then the first two workspace cards should have changed places
     When I reload the page
     Then the first two workspace cards should have changed places
     When I move the first workspace card one place on with the keyboard
     Then the workspace cards should be in the order they had
      And there should be no JavaScript errors

  Scenario: The player's speed and loop buttons act on its recording
    Given I am on "/"
      And the local storage "ws-media-speed" is set to "1.5"
     When a recording opens in the editor window
     Then the recording should play at 1.5 times its speed
      And the recording should show 2 chapters
     When I click on the element "#editor-modal-body [data-sound-speed='2']"
     Then the recording should play at 2 times its speed
      And the speed 2 should be kept for the next recording
     When I click on the element "#editor-modal-body [data-sound-loop]"
     Then the recording should loop
      And there should be no JavaScript errors
