#!/bin/usr/env bash

# Install Webship with Drush.
function install_webship_with_drush() {
  echo "Install Webship with Drush.";
  ddev drush site-install webship --yes --site-name="${doc_name} ${PROJECT_NAME}" --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" --db-url="mysql://db:db@db/db" ;
  ddev drush config:set system.performance css.preprocess 0 --yes ;
  ddev drush config:set system.performance js.preprocess 0 --yes ;
  ddev drush config:set system.logging error_level all --yes ;
  ddev drush cache:rebuild ;
}

# Enable Webship extra components.
function enable_webship_extra_components() {
  echo "Enable Webship extra components.";
}
# The default set of users `add_users` creates for Webship (--add-users).
function set_webship_users() {
  users=(authenticated content_editor administrator);
  user_authenticated_name="Authenticated user";
  user_authenticated_mail="test.authenticated@webship.org";
  user_authenticated_password="dD.123123ddd";
  user_authenticated_role="_none_";
  user_content_editor_name="Content editor";
  user_content_editor_mail="test.content_editor@webship.org";
  user_content_editor_password="dD.123123ddd";
  user_content_editor_role="content_editor";
  user_administrator_name="Webmaster";
  user_administrator_mail="test.Webmaster@webship.org";
  user_administrator_password="dD.123123ddd";
  user_administrator_role="administrator";
}
