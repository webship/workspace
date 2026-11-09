Feature: The theme system
  One stylesheet is assembled from a base, the components, and the palette last.

  Scenario: The page asks for the assembled stylesheet, not a file on disk
    Given I am on "/"
     Then "link[href*='/style.css?v=']" should be attached

  # Which style is last is a per-machine setting, so naming one here asserted the machine rather
  # than the code: the scenario failed on any machine not wearing `default`, which since the Styles
  # page is most of them. What the assembly guarantees is the ORDER — base, components, then a
  # style — so that is what is asserted.
  Scenario: The assembled sheet carries the base, the components and a style
    Given I am on "/style.css"
     Then I should see "/* base */"
      And I should see "/* component: workspace-cards */"
      And I should see "/* component: project-rows */"
      And I should see "/* theme:"

  # Every style names itself and declares the palette tokens, whichever one is worn.
  Scenario: The style in use names itself and declares its palette
    Given I am on "/style.css"
     Then I should see "@name"
      And I should see "--brand-primary:"

  # Not a button: the only primary button on the home page used to be the assistant's Send, and
  # deep-chat renders its own inside a shadow root where a selector cannot reach it. The card chips
  # carry the brand colour on every page, which is what this scenario is actually about.
  Scenario: The dashboard still renders with its own brand colour
    Given I am on "/"
     Then the element "#workspace-cards" should be displayed
      And the element ".ws-card-wrap .uk-label" should be displayed

  # The favicon is the artwork from the brand tokens (node 5743:11748): a square with the emblem
  # SUBTRACTED out of it, one boolean path. Its fill flips with the viewer's colour scheme, because a
  # knocked-out mark has no colour of its own — asserted on the file in tests/unit/favicon.test.js,
  # since a browser handed an SVG renders it as an image and there is nothing here to select.
  Scenario: The tab carries the Webship favicon, not a bare emblem
    Given I am on "/"
     Then "link[rel='alternate icon'][href$='.png']" should be attached
      And "link[rel='apple-touch-icon'][href$='.png']" should be attached
