#!/bin/usr/env bash

# Load the default user list of a distribution: `set_<distribution>_users` lives
# in functions/fun-distribution-<distribution>.sh, next to that distribution's
# install functions. Each cmd-*.sh sets distribution_name itself.
function load_distribution_users () {
  distribution_functions="${WEBSHIP_WORKSPACE_SCRIPTS}/functions/fun-distribution-${distribution_name}.sh" ;
  if [ -f "${distribution_functions}" ]; then
    source "${distribution_functions}" ;
  fi

  if declare -f set_${distribution_name}_users > /dev/null ; then
    set_${distribution_name}_users ;
  else
    echo "No default user list for '${distribution_name}' — add set_${distribution_name}_users() to fun-distribution-${distribution_name}.sh." ;
  fi

  # Callers that only know the project (cmd-tools-add-users.sh) get the docroot
  # from the project's own DDEV config.
  if [ -z "${distribution_webroot}" ] && [ -f "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/.ddev/config.yaml" ]; then
    distribution_webroot=$(grep '^docroot:' "${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/.ddev/config.yaml" | awk '{print $2}') ;
  fi
}

# Add users to a project.
function add_users () {

  # Add Drush if it was not in the system.
  add_drush ;

  load_distribution_users ;

  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/;

  for user in ${users[@]}
  do
    user_name="user_${user}_name";
    user_mail="user_${user}_mail";
    user_password="user_${user}_password";
    user_role="user_${user}_role";

    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo "  User password: ${!user_password}";
    echo "      User role: ${!user_role}";
    echo " ================================================================= ";

    ddev drush user:create "${!user_name}" --mail="${!user_mail}" --password="${!user_password}" ;
    if [ "${!user_role}" == '_none_' ] ; then
      echo "   No user role for this user" ;
    else
      ddev drush user:role:add "${!user_role}" "${!user_name}" ;
    fi
  done

  echo "Cache rebuilding ...";
  ddev drush cache:rebuild ;

  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name};
}

# Cancle users from a project and delete their content.
function cancel_users () {

  # Add Drush if it was not in the system.
  add_drush ;

  load_distribution_users ;

  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/;

  for user in ${users[@]}
  do
    user_name="user_${user}_name";

    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo " ================================================================= ";
    ddev drush user:cancel --delete-content "${!user_name}" -y ;
  done

  echo "Cache rebuilding ...";
  ddev drush cache:rebuild ;

  cd ${WEBSHIP_WORKSPACE_ROOT}/${doc_name};
}