#!/usr/bin/env bash

# Include Bash YAML library.
source ${WORKSPACE_SCRIPTS}/libs/bash-yaml.sh || exit 1 ;

# Include the arguments parser
source ${WORKSPACE_SCRIPTS}/libs/argparse.sh || exit 1 ;

# Include Bash Progress Bar library.
source ${WORKSPACE_SCRIPTS}/libs/progress-bar.sh || exit 1 ;