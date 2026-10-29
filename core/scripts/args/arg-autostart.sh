#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-e', '--enable',
                    action='store_true',
                    default=False,
                    help='Install the systemd user service that starts the configured projects at boot, and turn on lingering so it runs without anyone logging in.')
parser.add_argument('-d', '--disable',
                    action='store_true',
                    default=False,
                    help='Stop and remove the boot service. The domain stays as it is; only the automatic start goes.')
parser.add_argument('-o', '--domain',
                    default="_none_",
                    help='The one name the dashboard answers on, project and TLD together: workspace.ddev.site. The first label is the DDEV project name, the rest is the project TLD, and every workspace and project hostname follows from it.')
parser.add_argument('-a', '--apply',
                    action='store_true',
                    default=False,
                    help='Apply the domain from the settings file to DDEV now and restart, without changing what is configured.')
parser.add_argument('-n', '--now',
                    action='store_true',
                    default=False,
                    help='Start the configured projects immediately, exactly as the boot service would. Use it to prove the service will work before rebooting.')
parser.add_argument('-R', '--restart-all',
                    action='store_true',
                    default=False,
                    help='After a TLD change, restart every other running project so it answers on the new name too. Without this they are listed and left alone, because restarting a site mid-build is how a half-written database happens.')
parser.add_argument('-f', '--force',
                    action='store_true',
                    default=False,
                    help='Go ahead with a TLD that has no wildcard DNS, or with a project rename. Both are refused without this, and both break things in ways that are tedious to undo.')
ARGEOF
