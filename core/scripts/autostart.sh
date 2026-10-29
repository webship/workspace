#!/usr/bin/env bash

# The dashboard's own hostnames, and getting it back after a reboot.
#
# A DDEV project's containers carry `restart: no`, so nothing brings the dashboard back when the
# machine boots — every workspace URL then answers 404 from a router with nothing behind it. This
# installs a systemd USER service that runs `ddev start` for the configured projects at boot, and
# manages `hub_domain` — the one field every dashboard URL and DDEV's own routing are built from.
#
# Machine setup rather than per-project work, which is why it lives in core/scripts beside
# sync-tooling.sh and install.sh: it is run once when a machine is set up, takes no project name, and
# configures the box rather than acting on a project.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

eval $(parse_yaml ${WORKSPACE_CONFIG}/settings.yml);

ARGPARSE_DESCRIPTION="Bring the dashboard back after a reboot, and set the domain everything is built from"
source ${WORKSPACE_SCRIPTS}/args/arg-autostart.sh || exit 1 ;

shift $#;

autostart_command ;
