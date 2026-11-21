# Loaded by every bash in the dashboard's web container (BASH_ENV, set in docker-compose.screens.yaml): webship/workspace#564.
#
# That container shares the machine's process space (`pid: host`) so screen in it can reach the sessions on the machine.
# DDEV ends a web container's processes with `kill -- -1` (its start script's trap, and a failed start). In a container
# of its own that reaches only the container; with the machine's process space it reaches every process the user may
# signal outside it: the other containers' processes, and with no AppArmor every process of the user on the machine.
# So bash's kill here refuses -1 as a target, and the container stops the way any container does: Docker ends it.
#
# Only a TARGET of -1 is refused. `kill -1 1234` is SIGHUP to 1234 and goes through, as does every other kill.
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
      echo "kill: not signalling every process (-1): this container shares the machine's process space (webship/workspace#564)." >&2 ;
      return 1 ;
    fi
  done
  builtin kill "$@" ;
}
