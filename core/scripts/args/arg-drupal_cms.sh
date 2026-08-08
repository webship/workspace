#!/usr/bin/env bash

argparse "$@" <<EOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Add the install flag to install the project.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Add default set of users to the project in the case of install')
parser.add_argument('-p', '--profile',
                    default="standard",
                    nargs=1,
                    help='Which site template to install. Drupal CMS installs the drupal_cms_installer profile, not standard/minimal/umami, so this names a site template instead: drupal_cms_starter (the installer default), drupal_cms_site_template_base for a blank site, or one from the curated list (byte, haven, everbright, forma, archimedes, healthcare, pulse, summit, local, convene, caresphere, convivial_gov, provus_edu, mercury_demo). Left alone the installer picks drupal_cms_starter. Example: --profile drupal_cms_site_template_base')
parser.add_argument('-r', '--require',
                    default="_none_",
                    nargs='+',
                    help='Require more modules/themes/libraries by composer. Example: --require "drupal/ctools:~3.0 drupal/token:~1.0"')
parser.add_argument('-e', '--enable',
                    default="_none_",
                    nargs='+',
                    help='Enable modules right after the install. Example: --enable "media media_library ctools token"')
EOF