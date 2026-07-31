Compare two distributions from what is actually installed.

```
claude --permission-mode bypassPermissions """
Keep in a loop until the comparison is complete
- read the modules, sub-modules and recipes in ~/workspace/demos/<first-project>
- read the same for ~/workspace/demos/<second-project>
- read the the distribution feature files under tests/features/<distribution>
- read the <distribution> docs in the distribution's docs

Produce one table: capability · Drupal CMS · <distribution> · which module or recipe provides it.
Say plainly where each is stronger, and where they overlap.

Stop when every capability in both is accounted for
"""
```
