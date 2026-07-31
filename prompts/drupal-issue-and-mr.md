File the issue and open the MR the Webship way, in the real browser.

```
claude --permission-mode bypassPermissions """
Use playwright mcp and file an issue on https://www.drupal.org/project/<project>

# keep the default issue summary template, only add to it
# then create the issue fork, commit, push, and open the MR
# keep the default Checkpoints at the end of the MR body
# add the AI disclosure per the Drupal AI contribution policy
# never tick "Reviewed by a human" or "Code review by maintainers"
# ask me before creating anything, then create it

Show me the issue link and the MR link when done
"""
```

Log in with the browser session already signed in, or the token in
`core/config/settings.yml` — never paste an account password into a prompt.
