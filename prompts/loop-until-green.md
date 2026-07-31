Loop until the goal is done and the tests pass, in one DDEV project.

```
claude --permission-mode bypassPermissions """
Keep in a loop until you finish the goal
# keep working in the ~/workspace/test/<project> folder and the https://<project>.ddev.site ddev domain
# use DDEV when working
# use ddev drush uli and login
# use playwright mcp to test in the real browser

<the goal, in one line>

Stop when the tests are passing
"""
```

Add a hard rule when it matters:

```
claude --permission-mode bypassPermissions """
Keep in a loop until you finish the goal
# ~/workspace/test/<project> · https://<project>.ddev.site
# DDEV only — ddev composer, ddev drush, never the host
# do not commit or push; show me the diff

<the goal>

Stop when the tests are passing
"""
```
