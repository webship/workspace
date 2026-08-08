#!/usr/bin/env bash

# Install Webships with Drush.
function install_webships_with_drush() {
  echo "Install Webships with Drush.";
  ddev drush site:install webships --yes --site-name="${doc_name} ${PROJECT_NAME}" --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" --db-url="mysql://db:db@db/db" ;
}

# Enable Webships extra components.
function enable_webships_extra_components() {
  echo "Enable Webships extra components.";
}

# The default set of users `add_users` creates for Webships (--add-users).
function set_webships_users() {
  users=(authenticated app_admin api_admin administrator);
  user_authenticated_name="Authenticated user";
  user_authenticated_mail="test.authenticated@webship.org";
  user_authenticated_password="dD.123123ddd";
  user_authenticated_role="_none_";
  user_app_admin_name="App Admin";
  user_app_admin_mail="test.app_admin@webship.org";
  user_app_admin_password="dD.123123ddd";
  user_app_admin_role="api_admin";
  user_api_admin_name="API Admin";
  user_api_admin_mail="test.api_admin@webship.org";
  user_api_admin_password="dD.123123ddd";
  user_api_admin_role="api_admin";
  user_administrator_name="Super Admin";
  user_administrator_mail="test.administrator@webship.org";
  user_administrator_password="dD.123123ddd";
  user_administrator_role="administrator";
}
