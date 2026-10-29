#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    nargs='?',
                    default="_settings_",
                    help='The name of the project. It becomes https://<PROJECT_NAME>.ddev.site. Default: penpot.project from the workspace settings.')
parser.add_argument('-v', '--penpot-version',
                    default="_settings_",
                    help='Penpot image tag for every service. Default: penpot.version from the workspace settings.')
parser.add_argument('-u', '--public-uri',
                    default="_settings_",
                    help='PENPOT_PUBLIC_URI: hub, canonical, or a full URL. The one origin the instance works on. Default: penpot.public_uri from the workspace settings.')
parser.add_argument('-f', '--flags',
                    default="_settings_",
                    help='PENPOT_FLAGS, set on both the frontend and the backend. Default: penpot.flags from the workspace settings (registration, plugins and access tokens on).')
parser.add_argument('-k', '--secret-key',
                    default="_settings_",
                    help='PENPOT_SECRET_KEY. Default: penpot.secret_key, or a per-project key derived from the project name — never a shared literal.')
parser.add_argument('-M', '--mail-port',
                    default="_settings_",
                    help='Host port for this instance mail catcher. Default: penpot.mail_port, and the next free pair upwards when it is taken.')
parser.add_argument('-n', '--fullname',
                    default="_settings_",
                    help='Full name of the first account. Default: penpot.account.fullname, then the account: block in settings.yml.')
parser.add_argument('-m', '--email',
                    default="_settings_",
                    help='Email of the first account. Default: penpot.account.email, then account.mail.')
parser.add_argument('-p', '--password',
                    default="_settings_",
                    help='Password of the first account. Default: penpot.account.password, then account.pass.')
parser.add_argument('-R', '--no-register',
                    action='store_true',
                    default=False,
                    help='Do not register the first account — register it in the browser instead.')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the instance in a browser when it is ready.')
parser.add_argument('-F', '--force',
                    action='store_true',
                    default=False,
                    help='Recreate an existing project: delete the DDEV project (and its Penpot volumes, so the designs go too) and build it again.')
ARGEOF
