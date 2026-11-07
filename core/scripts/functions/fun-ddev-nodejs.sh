#!/bin/bash
## The Node.js every project this workspace builds runs on.
##
## 24, in line with Drupal core, whose package.json asks for "node": ">= 24.0".
## The major only: DDEV installs the latest 24.x when the container is built, so a
## security release arrives with the next build and nothing here changes.
##
## A builder that needs another declares site_nodejs_version, the way it declares
## site_php_version. Passed as --nodejs-version on EVERY `ddev config` that creates a
## project and on the one that follows a create-project: a project template ships its
## own .ddev/config.yaml, and an older release of one pins an older Node.

function ddev_nodejs_version() {
  echo "${site_nodejs_version:-24}" ;
}
