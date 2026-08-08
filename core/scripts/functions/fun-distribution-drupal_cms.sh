#!/usr/bin/env bash

# Install Drupal CMS with Drush.
#
# Drupal CMS ships the `drupal_cms_installer` profile, whose install tasks are
# ordinary forms, so they can be driven non-interactively. Left alone, the site
# template step (`installer_site_template_form`) defaults to `drupal_cms_starter`
# on a non-interactive install; pass PROFILE a recipe/site-template name to pick
# a different one (for example `drupal_cms_site_template_base` for a blank site).
function install_drupal_cms_with_drush() {
  echo "Install Drupal CMS with Drush.";

  # argparse hands --profile over as a bash array even at nargs=1, so read element [0]. One is all
  # the installer can take: its site-template step is a '#type' => 'radios' element keyed by a
  # single template name (SiteTemplateForm indexes $form['add_ons'][$choice]), and arg-drupal_cms.sh
  # refuses a second value at the command line rather than letting one be dropped here.
  #
  # standard|minimal|umami are Drupal core profile names — they mean nothing to Drupal CMS, so they
  # are accepted and ignored, leaving the installer on its own default of drupal_cms_starter.
  site_template_form_values="";
  site_template="${PROFILE[0]}";
  case "${site_template}" in
    standard|minimal|umami|"")
      ;;
    *)
      site_template_form_values="installer_site_template_form.add_ons=${site_template}";
      ;;
  esac

  ddev drush site:install drupal_cms_installer --yes --site-name="${doc_name} ${PROJECT_NAME}" --account-name="${account_name}" --account-pass="${account_pass}" --account-mail="${account_mail}" --db-url="mysql://db:db@db/db" --locale="en" installer_site_name_form.site_name="${doc_name} ${PROJECT_NAME}" ${site_template_form_values} ;
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
