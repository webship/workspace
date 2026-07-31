Implement or fix a component so it works in <distribution> Canvas.

```
claude --permission-mode bypassPermissions """
Keep in a loop until the component renders and the story passes
# ~/workspace/test/<project> · DDEV only · use ddev drush uli and login
# implement <component> in vartheme_bs5 to support <distribution> Canvas
# follow the pattern of an existing component, no new custom CSS
# ddev yarn storybook:gen && ddev yarn storybook:build
# check it with playwright mcp in the real browser, and in a Canvas page

Stop when the component renders in Storybook AND on a Canvas page, and tell me which
existing component you followed
"""
```
