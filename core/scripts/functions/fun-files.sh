#!/usr/bin/env bash

# Change file permissions and ownership
function set_chmod() {
  sudo chmod 775 -R ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;
}

# Change file permissions and ownership
function set_chown() {
  sudo chown www-data:${user_name} -R ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;
}

# Securing file permissions and ownership.
function set_chmod_chown() {
  echo "Securing file permissions and ownership";
  sudo chmod 775 -R ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;
  sudo chown www-data:${user_name} -R ${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME} ;
}

