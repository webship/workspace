# Loaded by every bash in the dashboard's web container (BASH_ENV, set in docker-compose.screens.yaml): webship/workspace#564.
#
# DDEV ends a web container's processes with `kill -- -1` (its start script's trap, and a failed start). In a container
# with a process space of its own that reaches only the container. The dashboard's container used to share the
# machine's process space (`pid: host`) so screen in it could reach the sessions on the machine, and from there it
# reaches every process the user may signal outside it: the other containers' processes, and with no AppArmor every
# process of the user on the machine. So bash's kill here refuses -1 as a target, and the container stops the way any
# container does: Docker ends it.
#
# The container has a process space of its own since the host runner does every screen verb (#591), and this file is
# kept: it is harmless there, and a container made from an older docker-compose.screens.yaml still mounts it.
#
# Only a TARGET of -1 is refused. `kill -1 1234` is SIGHUP to 1234 and goes through, as does every other kill.

# This file takes the place of DDEV's own BASH_ENV, which every non-interactive bash in a web container loads: the PATH
# of vendor/bin, ~/bin, /var/www/html/bin and DDEV's in-container commands, and ~/.bashrc.d. So that is loaded first,
# and the guard is defined after it: nothing DDEV sets up is lost, and nothing it loads can take the guard's place.
if [ -r /etc/bash.nointeractive.bashrc ] ; then
  . /etc/bash.nointeractive.bashrc ;
fi

kill() {
  local args=("$@") i=0 t ;
  case "${args[0]:-}" in
    -l|-L) builtin kill "$@" ; return ;;
    -s|-n) i=2 ;;
    --) i=0 ;;
    -*) i=1 ;;
  esac
  [ "${args[$i]:-}" = "--" ] && i=$(( i + 1 )) ;
  for t in "${args[@]:$i}" ; do
    if [ "${t}" = "-1" ] ; then
      echo "kill: not signalling every process (-1) from the dashboard's web container: from the machine's process space it reaches the other containers (webship/workspace#564)." >&2 ;
      return 1 ;
    fi
  done
  builtin kill "$@" ;
}
