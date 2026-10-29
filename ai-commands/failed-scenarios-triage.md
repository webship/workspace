Take a failed-scenario list and work it down to zero.

```
claude --permission-mode bypassPermissions """
Keep in a loop until no scenario fails
# ~/workspace/test/<project> · https://<project>.ddev.site · DDEV only
# use playwright mcp to watch each failure in the real browser before changing anything

--- Failed scenarios:
<paste the list from the runner>

For each one: say whether it is the test, the module, or the distribution.
Fix what is ours. For an upstream bug, file the issue and add the patch through
<distribution>-patches instead of editing contrib in place.

Stop when the suite is green and tell me which fixes were upstream
"""
```
