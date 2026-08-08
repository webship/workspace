#!/usr/bin/env bash

# Install Drupal CMS with Drush.
#
# Drupal CMS ships the `drupal_cms_installer` profile, whose install tasks are
# ordinary forms, so they can be driven non-interactively. The site-template step
# (`installer_site_template_form`) settles on `drupal_cms_starter` by itself on a
# non-interactive install, which is what a plain Drupal CMS build wants.
#
# Choosing a different template is what the site-templates workspace is for: those
# builders require the template package and name it to the same form.
function install_drupal_cms_with_drush() {
  echo "Install Drupal CMS with Drush.";

  ddev drush site:install drupal_cms_installer --yes --site-name="${doc_name} ${PROJECT_NAME}" --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" --db-url="mysql://db:db@db/db" --locale="en" installer_site_name_form.site_name="${doc_name} ${PROJECT_NAME}" ;
}

# Enable Drupal CMS extra components.
function enable_drupal_cms_extra_components() {
  echo "Enable Drupal CMS extra components.";

}

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
