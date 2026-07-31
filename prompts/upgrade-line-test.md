Build the old line, upgrade it with the agent, prove the site still works.

```
claude --permission-mode bypassPermissions """
Keep in a loop until the upgraded site is working
# build ~/workspace/test/<old-project> on the <old> line and install it
# then use the <distribution>-upgrade-<old>-to-<new> agent to upgrade it in place
# DDEV only · use ddev drush uli and login · playwright mcp for the real browser

Check after the upgrade: front page, admin, content editing, the theme, and
ddev drush status has no errors

Stop when the upgraded site is working and list what the upgrade changed
"""
```
