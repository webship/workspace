#!/bin/usr/env bash

# Include users functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-users.sh || exit 1 ;

# Include Default settings functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-default-settings.sh || exit 1 ;

# Include Database functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-database.sh || exit 1 ;

# Include Files functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-files.sh || exit 1 ;

# Include drush functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-drush.sh || exit 1 ;

# Include Gleap functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-gleap.sh || exit 1 ;

# Include distribution functions.
source ${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-build-distribution.sh || exit 1 ;
