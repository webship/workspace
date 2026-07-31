Release a <distribution> line after a Drupal core release, with the MRs left for review.

```
claude --permission-mode bypassPermissions """
use @"<distribution>-<line>-release (agent)" and release <distribution>_project <version> after you
manage the issue with @"webship-mr-pr-manager (agent)" and @"drupal-issue-manager (agent)",
titled: Update Drupal Core to <core version> on the 11.0.x branch

# keep the constraint at ~<core minor> — only refresh composer.lock and patches.lock.json
# create the MRs and let me review first, do not merge and do not tag
# wait 5-10 seconds between drupal.org calls
"""
```

Same shape per line — swap the agent and the branch:

```
claude --permission-mode bypassPermissions """
use @"<distribution>-<line>-release (agent)" and release <distribution>_project <version>, issue titled
Update Drupal Core to <core version> on the 10.1.x branch. Locks only, MRs for review.
"""
```

Credentials come from `core/config/settings.yml` (`git.drupal.token`) and `gh auth` — never put a
token in the prompt.
