#!/bin/usr/env bash

# Include Bash YAML library.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/libs/bash-yaml.sh || exit 1 ;

# Include the arguments parser
source ${WEBSHIP_WORKSPACE_SCRIPTS}/libs/argparse.sh || exit 1 ;

# Include Bash Progress Bar library.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/libs/progress-bar.sh || exit 1 ;