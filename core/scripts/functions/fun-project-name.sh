#!/usr/bin/env bash

# The one place a project name gets cleaned up, called from every cmd-*.sh that takes one.
#
# A directory name copy-pasted or tab-completed carries a trailing slash more often than not —
# `cd dev/v11x00b1<TAB>` appends one, and so does copying a name straight out of a directory
# listing. That slash is never part of the project name, only of how it arrived, so every command
# that takes PROJECT_NAME as its positional trims it before using it anywhere.
#
# One real implementation rather than the same trim (and the same explanation) pasted into 42
# files: each command still calls it explicitly, right after its own `shift $#;`, because
# PROJECT_NAME does not exist until that command's own argparse has run — bootstrap.sh loads this
# function before that, but cannot act on a variable nothing has set yet.
function trim_project_name() {
  if [ "$#" -gt 0 ] ; then
    printf '%s' "${1%/}" ;
  else
    PROJECT_NAME="${PROJECT_NAME%/}" ;
  fi
}
