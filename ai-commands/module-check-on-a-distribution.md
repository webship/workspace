Test a contrib module on <distribution>, document it, and record the walkthrough.

```
claude --permission-mode bypassPermissions """
use @"drupal-check-module (agent)" and @"<distribution>-docs-manager (agent)" and
@"<distribution>-demo-video-manager (agent)"

Test <module> <version> on <distribution> 11: build a project in ~/workspace/test/,
use playwright mcp and show me the real browser, and cover <what to exercise —
e.g. multilingual sites and the translation process after the <x> release>.

# activate <distribution> i18n where the test needs it
# save the videos in ~/workspace/videos/ and the report in ~/workspace/docs/

Stop with a verdict: works on <distribution>, works with caveats, or does not work — and why
"""
```
