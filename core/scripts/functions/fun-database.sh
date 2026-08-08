#!/usr/bin/env bash

# Each DDEV project gets its own isolated database container, so there is no
# shared host database to drop between rebuilds -- deleting the DDEV project
# (containers + volumes) gives the same clean-slate guarantee.
function drop_database() {
  echo "Removing any existing DDEV project for a clean rebuild";
  ddev delete "${PROJECT_NAME}" -y -O 2>/dev/null || true ;
}
