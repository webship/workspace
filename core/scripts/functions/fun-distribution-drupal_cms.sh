#!/bin/usr/env bash

# Drupal CMS installs its recipes through the browser installer; there is no
# install_drupal_cms_with_drush() yet, so `--install` on the Drupal CMS builders
# stops here. This file carries the default user list in the meantime.

# The default set of users `add_users` creates for Drupal CMS (--add-users).
function set_drupal_cms_users() {
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
