#!/bin/usr/env bash

# Include users functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-users.sh || exit 1 ;

# Include Default settings functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-default-settings.sh || exit 1 ;

# Include Database functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-database.sh || exit 1 ;

# Include Files functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-files.sh || exit 1 ;

# Include drush functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-drush.sh || exit 1 ;

# Include distribution functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-build-distribution.sh || exit 1 ;

# Include automated-testing functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-testing.sh || exit 1 ;

# Include graphify (knowledge graph) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-graphify.sh || exit 1 ;

# Include graphs workspace (the graph store) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-graphs.sh || exit 1 ;

# Include structured-prompt (spec) functions.
source ${WORKSPACE_SCRIPTS}/functions/fun-spdd.sh || exit 1 ;
