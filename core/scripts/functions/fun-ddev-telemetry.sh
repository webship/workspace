#!/bin/bash
## Keep Drupal CMS install telemetry off in every project this workspace builds.
##
## Drupal CMS reports anonymous install analytics. It skips GitLab CI, GitHub
## Actions and Tugboat by environment, but not a local DDEV site, so test builds
## here were counted as real installs. DRUPAL_CMS_TELEMETRY=0 in the web container
## turns it off before the installer runs.
##
## Written through `ddev config --web-environment-add`, never by editing the YAML,
## and called after EVERY `ddev config` that follows a create-project: a project
## template ships its own .ddev/config.yaml and can replace the list.

function ddev_telemetry_off() {
  ddev config --web-environment-add=DRUPAL_CMS_TELEMETRY=0 > /dev/null ;
}
