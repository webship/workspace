#!/usr/bin/env bash

# Install Cucumber with Drush.
function install_cucumber_with_drush() {
  echo "Install Cucumber with Drush.";
  ddev drush site:install cucumber --yes --site-name="${doc_name} ${PROJECT_NAME}" --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" --db-url="mysql://db:db@db/db" ;
}

# Enable Cucumber extra components.
function enable_cucumber_extra_components() {
  echo "Enable Cucumber extra components.";
}

# The six work roles of Cucumber exist only once their role modules are on, and a
# `drush site:install cucumber` build leaves them off. `add_users` runs this before it
# creates the accounts, so each one can be given its role on a fresh build.
function prepare_cucumber_users() {
  echo "Enable the Cucumber role modules of the default users.";
  ddev drush pm:enable --yes cucumber_user_role_developer cucumber_user_role_tester cucumber_user_role_analyst \
    cucumber_user_role_designer cucumber_user_role_coordinator cucumber_user_role_product_owner ;
}

# The default set of users `add_users` creates for Cucumber (--add-users):
# one account per work role, and one with the Admin role of the profile.
function set_cucumber_users() {
  users=(authenticated developer tester analyst designer coordinator product_owner administrator);
  user_authenticated_name="Authenticated user";
  user_authenticated_mail="test.authenticated@webship.org";
  user_authenticated_password="dD.123123ddd";
  user_authenticated_role="_none_";
  user_developer_name="Developer";
  user_developer_mail="test.developer@webship.org";
  user_developer_password="dD.123123ddd";
  user_developer_role="developer";
  user_tester_name="Tester";
  user_tester_mail="test.tester@webship.org";
  user_tester_password="dD.123123ddd";
  user_tester_role="tester";
  user_analyst_name="Analyst";
  user_analyst_mail="test.analyst@webship.org";
  user_analyst_password="dD.123123ddd";
  user_analyst_role="analyst";
  user_designer_name="Designer";
  user_designer_mail="test.designer@webship.org";
  user_designer_password="dD.123123ddd";
  user_designer_role="designer";
  user_coordinator_name="Coordinator";
  user_coordinator_mail="test.coordinator@webship.org";
  user_coordinator_password="dD.123123ddd";
  user_coordinator_role="coordinator";
  user_product_owner_name="Product Owner";
  user_product_owner_mail="test.product_owner@webship.org";
  user_product_owner_password="dD.123123ddd";
  user_product_owner_role="product_owner";
  user_administrator_name="Administrator";
  user_administrator_mail="test.administrator@webship.org";
  user_administrator_password="dD.123123ddd";
  # Cucumber has no `administrator` role: its administration role is Admin (`admin`).
  user_administrator_role="admin";
}
