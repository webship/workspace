Save what a release taught us back into the agent.

```
claude --permission-mode bypassPermissions """
Save our history, comments, tips, prompts and findings from the <version> release into the
local @"<distribution>-<line>-release (agent)", then open the PR to Webship/dev-ai-agents for review.

# keep it to what was NOT obvious — the traps, the order, the commands that mattered
# no tokens, no passwords, no client names
"""
```
