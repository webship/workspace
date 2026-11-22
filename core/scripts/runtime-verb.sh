#!/usr/bin/env bash

# A runtime verb on the project in the current folder, for the dashboard's runtime menu (webship/workspace#694):
#
#   cd <project> && bash core/scripts/runtime-verb.sh start|stop|restart|describe|logs|ssh|delete|drush …
#
# It loads the workspace and calls `ddev <verb>`: the runtime layer (functions/fun-runtime.sh) gives the verb its
# meaning on the project's runtime (Docker Compose, Podman, Kubernetes), and on a DDEV project it is DDEV itself.
# The shell keeps its stdin when it is a terminal (`ssh` is a shell in the web container).

# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
runtime_verb_dir="$(pwd)";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;
cd "${runtime_verb_dir}" || exit 1 ;

if [ $# -eq 0 ] ; then
  echo "Usage: bash runtime-verb.sh <verb> [arguments]   (in a project folder)" ;
  exit 1 ;
fi

# A local kind cluster's CLI is often in ~/.local/bin, which a session started by the dashboard may not have on PATH.
case ":${PATH}:" in *":${HOME}/.local/bin:"*) ;; *) [ -d "${HOME}/.local/bin" ] && PATH="${PATH}:${HOME}/.local/bin" ;; esac

if ! rt_find_project > /dev/null ; then
  echo "No project in $(pwd): no .ddev/config.yaml, and no compose.yaml written by the Webship Workspace." ;
  exit 1 ;
fi

ddev "$@" ;
