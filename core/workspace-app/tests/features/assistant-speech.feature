Feature: Talking to the assistant
  The panel takes dictation and reads its answer back. Both are the browser's own — no key, no
  service, nothing leaves the machine — so what is asserted here is that the component was actually
  handed a working configuration, not that a remote service replied.

  # Asserting the button EXISTS, not that speech works: a scenario cannot speak, and a browser will
  # not grant a microphone to an automated run. What can go wrong without anyone noticing is the
  # button being absent, or present with a config deep-chat silently ignored — so that is the target.
  Scenario: The assistant offers a microphone
    Given I am on "/"
     Then "deep-chat" should be attached
      And the assistant should offer voice input
      And the assistant should read its replies aloud

  # The microphone is what says voice is available. It used to be said in the placeholder as well
  # ("Ask about dev… (or use voice)"), but the composer ships with no placeholder at all now: an
  # empty field with a cursor in it already says "type here", and a prompt that suggests what to ask
  # narrows what gets asked. So the button has to be there AND have a name — an icon-only control
  # with no accessible name is a button a screen reader announces as nothing.
  Scenario: The microphone is there, and it is named
    Given I am on "/"
     Then the assistant should show a named microphone button

  # Nothing drawn in the box, and the box still has a name. These are one scenario because they are
  # in tension: deep-chat resolves the placeholder as `text || "Ask me anything!"`, so an empty
  # string does not remove its placeholder, it restores deep-chat's — and the text it is given also
  # becomes the composer's aria-label. Removing what is drawn without removing the name is the whole
  # trick, and either half alone is a bug.
  Scenario: The composer shows no placeholder, and is still named
    Given I am on "/"
     Then the assistant composer should draw no placeholder
      And the assistant composer should have an accessible name

  # The recogniser's language is the setting that decides whether dictation works in a second
  # language at all: left on the wrong one it does not fail, it returns confident nonsense. So a
  # language is always pinned rather than inherited — en-US ships, and the dropdown offers the rest.
  Scenario: A dictation language is always pinned, never left to chance
    Given I am on "/"
     Then the assistant speech language should be pinned

  # An empty phrase is not a disabled command. If `commands` were built from blank strings, a
  # command could fire on almost anything dictated — so with none configured the key must be absent.
  Scenario: No voice commands are armed unless one is configured
    Given I am on "/"
     Then the assistant should have no voice commands

  Scenario: Voice styling follows the theme rather than deep-chat's stock colours
    Given I am on "/"
     Then the assistant speech colours should be design tokens

  # The panel is on every workspace page, not only the home page, and its context travels with it.
  Scenario: A workspace page gets the same microphone
    Given I am on "/dev"
     Then "deep-chat" should be attached
      And the assistant should offer voice input

  # A browser with no synthesis voices accepts speak(), fires error: synthesis-failed, and is silent.
  # Nothing reported it, so "read replies aloud" looked switched on and did nothing at all — the worst
  # state a setting can be in.
  Scenario: The settings page says which voices this browser actually has
    Given I am on "/settings"
     Then "[data-voice-name]" should be attached
      And the voice list should report what this browser has
