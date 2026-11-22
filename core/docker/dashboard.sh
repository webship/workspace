#!/usr/bin/env bash

# The entrypoint of the Webship Workspace's dashboard image (core/docker/Dockerfile, webship/workspace#694).
#
# It runs as the host's user by number, gives that number a name, installs the dashboard's dependencies when they
# are missing, and keeps `node server.js` running: a plugin step or an update restarts the dashboard by ending that
# one process (core/scripts/plugins.sh --restart), and this starts it again. The container itself is not restarted
# for that, so the screen sessions running in it (a build, the step that asked for the restart) go on.
#
#   WORKSPACE_ROOT              the workspace, mounted at the path it has on the host
#   PORT                        the port the dashboard listens on (3000)
#   WEBSHIP_DASHBOARD_PIDFILE   where the dashboard's process id is kept (/tmp/webship-dashboard.pid)

set -u ;

if [ -z "${WORKSPACE_ROOT:-}" ] ; then
  echo "WORKSPACE_ROOT is not set: it names the workspace, mounted at the same path as on the host." >&2 ;
  exit 1 ;
fi
APP="${WORKSPACE_ROOT}/core/workspace-app" ;
if [ ! -f "${APP}/server.js" ] ; then
  echo "No workspace at ${WORKSPACE_ROOT} (core/workspace-app/server.js is missing). Mount the workspace at that path;" >&2 ;
  echo "make one with:  webship-workspace init ${WORKSPACE_ROOT} --runtime docker" >&2 ;
  exit 1 ;
fi

# A name for this user and group number: screen refuses to run without one, and git asks for it.
if ! getent passwd "$(id -u)" > /dev/null 2>&1 ; then
  echo "webship:x:$(id -u):$(id -g):Webship Workspace:${HOME:-/home/webship}:/bin/bash" >> /etc/passwd 2> /dev/null || true ;
fi
if ! getent group "$(id -g)" > /dev/null 2>&1 ; then
  echo "webship:x:$(id -g):" >> /etc/group 2> /dev/null || true ;
fi
export HOME="${HOME:-/home/webship}" ;
export USER="$(id -un 2> /dev/null || echo webship)" ;
mkdir -p "${HOME}" 2> /dev/null || true ;

# In a pod: a kubeconfig from the pod's own ServiceAccount, under the context name the chart gives
# (WORKSPACE_KUBE_CONTEXT), so the runtime layer's `kubectl --context <name>` reaches the cluster it runs in.
SA=/var/run/secrets/kubernetes.io/serviceaccount ;
if [ -r "${SA}/token" ] && [ -n "${KUBERNETES_SERVICE_HOST:-}" ] && [ -z "${KUBECONFIG:-}" ] && [ ! -e "${HOME}/.kube/config" ] ; then
  mkdir -p "${HOME}/.kube" ;
  cat > "${HOME}/.kube/config" <<YAML
apiVersion: v1
kind: Config
clusters:
  - name: in-cluster
    cluster:
      server: https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT:-443}
      certificate-authority: ${SA}/ca.crt
users:
  - name: dashboard
    user:
      tokenFile: ${SA}/token
contexts:
  - name: ${WORKSPACE_KUBE_CONTEXT:-in-cluster}
    context:
      cluster: in-cluster
      user: dashboard
current-context: ${WORKSPACE_KUBE_CONTEXT:-in-cluster}
YAML
  chmod 0600 "${HOME}/.kube/config" ;
fi

# screen walks every possible file descriptor when it starts. Where the limit is in the hundreds of millions (a pod
# of a containerd cluster gives 1073741816), every `screen -ls` then takes seconds, and the dashboard asks often:
# its pages waited three seconds each. 65536 is more than the dashboard and its sessions open. The hard limit too:
# Node.js raises its own soft limit to the hard one when it starts, and its children (screen) inherit that.
nofile="$(ulimit -Hn)" ;
if [ "${nofile}" = unlimited ] || [ "${nofile}" -gt 65536 ] 2> /dev/null ; then ulimit -n 65536 ; fi

cd "${APP}" || exit 1 ;

# The dashboard's dependencies, when the workspace came without them or its package.json is newer than they are.
if [ ! -d node_modules ] || [ package.json -nt node_modules/.package-lock.json ] ; then
  echo "Installing the dashboard's dependencies (npm install in ${APP})." ;
  npm install --no-audit --no-fund || { echo "npm install failed in ${APP}." >&2 ; exit 1 ; } ;
fi

PIDFILE="${WEBSHIP_DASHBOARD_PIDFILE:-/tmp/webship-dashboard.pid}" ;
export WEBSHIP_DASHBOARD_PIDFILE="${PIDFILE}" ;
# The workspace this container serves: plugins.sh restarts the dashboard only for that one.
export WEBSHIP_DASHBOARD_ROOT="${WORKSPACE_ROOT}" ;

stopping="" ;
pid="" ;
# The container is stopping: the dashboard ends, and this with it.
trap 'stopping=1 ; [ -n "${pid}" ] && kill -TERM "${pid}" 2> /dev/null' TERM INT ;

fast=0 ;
while true ; do
  started="$(date +%s)" ;
  node server.js &
  pid=$! ;
  echo "${pid}" > "${PIDFILE}" ;
  # `wait` returns early when a signal arrives: wait again until the process is really gone.
  while kill -0 "${pid}" 2> /dev/null ; do wait "${pid}" ; done
  rm -f "${PIDFILE}" ;
  [ -n "${stopping}" ] && exit 0 ;
  # Ended on its own: a restart that was asked for, or a crash. Started again; a dashboard that cannot stay up
  # for ten seconds five times in a row is left down, with its last words in the container's log.
  if [ $(( $(date +%s) - started )) -lt 10 ] ; then fast=$(( fast + 1 )) ; else fast=0 ; fi
  if [ "${fast}" -ge 5 ] ; then echo "The dashboard ended five times within seconds of starting: not started again." >&2 ; exit 1 ; fi
  echo "The dashboard's process ended; starting it again." ;
  sleep 1 ;
done
