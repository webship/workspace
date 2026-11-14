#!/usr/bin/env bash

# Load the default user list of a distribution: `set_<distribution>_users` lives
# in functions/fun-distribution-<distribution>.sh, next to that distribution's
# install functions. Each cmd-*.sh sets distribution_name itself.
function load_distribution_users () {
  distribution_functions="${WORKSPACE_SCRIPTS}/functions/fun-distribution-${distribution_name}.sh" ;
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
  if [ -z "${distribution_webroot}" ] && [ -f "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/.ddev/config.yaml" ]; then
    distribution_webroot=$(grep '^docroot:' "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/.ddev/config.yaml" | awk '{print $2}') ;
  fi
}

# Add users to a project.
function add_users () {

  # A platform that is not Drupal creates its accounts with its own CLI: add_<distribution>_users,
  # from the plugin of that platform, next to its set_<distribution>_users list.
  if declare -f add_${distribution_name}_users > /dev/null ; then
    load_distribution_users ;
    add_${distribution_name}_users ;
    return $? ;
  fi

  # Add Drush if it was not in the system.
  add_drush ;

  load_distribution_users ;

  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/;

  # A distribution whose roles only exist once something is switched on (Cucumber's work roles
  # come from their role modules) declares prepare_<distribution>_users next to its list. It runs
  # here, so the accounts get their roles on a fresh build and from cmd-tools-add-users.sh alike.
  if declare -f prepare_${distribution_name}_users > /dev/null ; then
    if ! prepare_${distribution_name}_users ; then
      echo "The roles of the default users could not be prepared — no user was added." ;
      cd ${WORKSPACE_ROOT}/${doc_name};
      return 1 ;
    fi
  fi

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

  cd ${WORKSPACE_ROOT}/${doc_name};
}

# Cancle users from a project and delete their content.
function cancel_users () {

  # The same door for a platform that is not Drupal: cancel_<distribution>_users, from its plugin.
  if declare -f cancel_${distribution_name}_users > /dev/null ; then
    load_distribution_users ;
    cancel_${distribution_name}_users ;
    return $? ;
  fi

  # Add Drush if it was not in the system.
  add_drush ;

  load_distribution_users ;

  cd ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}/${distribution_webroot}/;

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

  cd ${WORKSPACE_ROOT}/${doc_name};
}