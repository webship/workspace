#!/usr/bin/env bash

# workspace-name: Claude Code UI

# Build github.com/siteboon/claudecodeui as a DDEV generic project: clone (or reuse) the repo,
# configure DDEV as a generic Node 24 project, install deps, and start the Vite + Express dev
# stack. Not a Drupal distribution: no composer, no drush, no docroot.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

repo_url="https://github.com/siteboon/claudecodeui.git";
project_name="claudecodeui";
vite_port="5173";
server_port="3001";

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-i', '--install', action='store_true', default=False, help='Run npm install and start the dev servers after DDEV config (off by default: safe to re-run for just the DDEV config step).')
parser.add_argument('-f', '--force', action='store_true', default=False, help='Remove an existing checkout at this path first, and clone fresh.')
ARGEOF

# This workspace (test/) is where the script lives, so build alongside it.
project_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/${project_name}";

if [ "${FORCE}" == 'yes' ] && [ -d "${project_path}" ]; then
  cd "${project_path}" && ddev delete -y -O 2>/dev/null ;
  cd "${WORKSPACE_ROOT}" ;
  rm -rf "${project_path}" ;
fi

if [ ! -d "${project_path}" ]; then
  git clone "${repo_url}" "${project_path}" || exit 1 ;
fi

cd "${project_path}" ;

if [ ! -f ".ddev/config.yaml" ]; then
  ddev config --project-type=generic --project-name="${project_name}" --docroot="" --nodejs-version=24 ;
fi

# Expose the Vite dev server through ddev-router. The backend (SERVER_PORT) stays
# container-internal: vite.config.js already proxies /api, /ws, /shell, /plugin-ws to it.
if ! grep -q "^web_extra_exposed_ports:" .ddev/config.yaml 2>/dev/null; then
  cat >> .ddev/config.yaml <<EXTRAEOF
web_extra_exposed_ports:
  - name: vite
    container_port: ${vite_port}
    http_port: 5172
    https_port: ${vite_port}
EXTRAEOF
fi

ddev start ;

if [ ! -f ".env" ]; then
  cp .env.example .env ;
fi

# The project root mounts to /var/www/html inside the web container (generic type, no docroot).
if [ "${INSTALL}" == 'yes' ]; then
  ddev exec --dir /var/www/html "npm install" ;
  ddev exec --dir /var/www/html "nohup npm run dev > /tmp/claudecodeui-dev.log 2>&1 & disown" ;
  echo "claudecodeui dev stack starting. Tail with: ddev exec 'tail -f /tmp/claudecodeui-dev.log'" ;
  echo "Open: https://${project_name}.ddev.site:${vite_port}" ;
fi
