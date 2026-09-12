#!/usr/bin/env bash

# The default set of users `add_users` creates for the Website stack (--add-users).
# The site templates build on the Standard recipe roles.
function set_website_users() {
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
  user_administrator_mail="test.webmaster@webship.org";
  user_administrator_password="dD.123123ddd";
  user_administrator_role="administrator";
}
