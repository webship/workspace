Respond to a Drupal core security advisory across the supported lines.

```
claude --permission-mode bypassPermissions """
Keep in a loop until every supported line is covered
# <paste the SA links and the core release>

For each supported <distribution> line: update the core constraint if it needs it, refresh
composer.lock and patches.lock.json in DDEV, re-check every patch still applies, and run the
automated functional testing round on a fresh build.

File one issue per line with @"drupal-issue-manager (agent)" and open the MRs with
@"webship-mr-pr-manager (agent)". Leave the release itself to me.

Stop with a table: line · core version · patches re-rolled · tests green
"""
```
