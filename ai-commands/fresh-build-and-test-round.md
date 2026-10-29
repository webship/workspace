Fresh build, fresh install, full automated functional testing round.

```
claude --permission-mode bypassPermissions """
Keep in a loop until the round is green
# build ~/workspace/test/<project> with cmd-<distribution><version>-project.sh
# install it, then: ddev init-full-automated-testing, ddev yarn install,
#   ddev npx playwright install chromium, ddev yarn test:chromium
# use playwright mcp to look at anything that fails, in the real browser
# save the report and the recordings under ~/workspace/videos/

Report which scenarios failed and why, then fix and re-run

Stop when every scenario passes
"""
```
