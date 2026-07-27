#!/bin/usr/env bash

# Install Drupal with Drush.
function install_drupal_with_drush() {
    echo "Install Drupal with Drush.";
  ddev drush site:install ${PROFILE} --yes --site-name="${doc_name} ${PROJECT_NAME}" --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" --db-url="mysql://db:db@db/db" --locale="en" install_configure_form.enable_update_status_emails=NULL --debug -vvv ;
}

# Enable Drupal extra components.
function enable_drupal_extra_components() {
  echo "Enable Drupal extra components.";

}
# The default set of users `add_users` creates for Drupal (--add-users).
function set_drupal_users() {
  users=(authenticated administrator);
  user_authenticated_name="Authenticated user";
  user_authenticated_mail="test.authenticated@webship.org";
  user_authenticated_password="dD.123123ddd";
  user_authenticated_role="_none_";
  user_administrator_name="Administrator";
  user_administrator_mail="test.administrator@webship.org";
  user_administrator_password="dD.123123ddd";
  user_administrator_role="administrator";
}
