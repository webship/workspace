#!/usr/bin/env bash

# Detached screen sessions with logs the dashboard can follow. A session started
# here survives terminal exits and dashboard restarts; its output lives in
# <workspace>/.screens/<session>.log, which --log, --follow and the dashboard's
# Screens modal all read.
function screen_command() {
  local logdir="${WORKSPACE_ROOT}/.screens" ;
  mkdir -p "${logdir}" ;

  if [ "${LIST}" == 'yes' ] ; then
    screen -ls 2>/dev/null | sed -n 's/^\s\+[0-9]\+\.\(\S\+\)\s\+(\(.*\))/\1  (\2)/p' | while read -r line ; do
      name="${line%% *}" ;
      if [ -f "${logdir}/${name}.log" ] ; then echo "${line}  [log]" ; else echo "${line}" ; fi
    done ;
    [ "$(screen -ls 2>/dev/null | grep -c '^\s')" -gt 0 ] || echo "No screen sessions." ;
    return 0 ;
  fi

  if [ "${SESSION}" == '_none_' ] || [ -z "${SESSION}" ] ; then
    echo "Name a session, or use --list." ;
    return 1 ;
  fi
  if ! echo "${SESSION}" | grep -qE '^[a-z0-9][a-z0-9_.-]*$' ; then
    echo "A session name is lowercase letters, digits, - _ . only." ;
    return 1 ;
  fi
  local logfile="${logdir}/${SESSION}.log" ;

  if [ ! "${RUN}" == '_none_' ] && [ -n "${RUN}" ] ; then
    if screen -ls 2>/dev/null | grep -q "[.]${SESSION}[[:space:]]" ; then
      echo "'${SESSION}' is already running — pick another name or stop it first." ;
      return 1 ;
    fi
    : > "${logfile}" ;
    # tee, not a plain redirect: the output has to reach BOTH the log and the
    # session's own window, or the dashboard's browser terminal shows a blank
    # pane for everything started here.
    screen -dmS "${SESSION}" bash -c "{ ${RUN} ; } 2>&1 | tee -a \"${logfile}\"" ;
    sleep 1 ;
    if ! screen -ls 2>/dev/null | grep -q "[.]${SESSION}[[:space:]]" ; then
      # The session is already gone. Empty log = it never ran (bad command, no
      # screen); output present = it simply finished faster than this check.
      if [ -s "${logfile}" ] ; then
        echo "'${SESSION}' already finished — its whole output:" ;
        cat "${logfile}" ;
        echo "  log: ${logfile}" ;
        return 0 ;
      fi
      echo "'${SESSION}' did not start and wrote nothing — check the command." ;
      return 1 ;
    fi
    echo "Started '${SESSION}' — it keeps running after this terminal closes." ;
    echo "  follow:   bash cmd-tools-screen.sh ${SESSION} --follow" ;
    echo "  reattach: screen -r ${SESSION}   (Ctrl-A D detaches again)" ;
    echo "  log:      ${logfile}" ;
    return 0 ;
  fi

  if [ "${STOP}" == 'yes' ] ; then
    if ! screen -ls 2>/dev/null | grep -q "[.]${SESSION}[[:space:]]" ; then
      echo "No session called '${SESSION}' — 'screen -S' would otherwise kill one whose name merely starts with it." ;
      return 1 ;
    fi
    screen -S "${SESSION}" -X quit && echo "Stopped '${SESSION}'." ;
    return $? ;
  fi

  # A session a plugin started may log inside the project it works, as .<session-tail>.log (a Jira
  # agent's `dev--site1--jira-key-1` writes .JIRA-KEY-1.log there): looked for by name, case aside.
  if [ ! -f "${logfile}" ] ; then
    local tail_name found ;
    tail_name="${SESSION##*--}" ;
    found="$(find "${WORKSPACE_ROOT}" -maxdepth 3 -iname ".${tail_name}.log" -print -quit 2>/dev/null)" ;
    [ -n "${found}" ] && logfile="${found}" ;
  fi

  if [ "${FOLLOW}" == 'yes' ] ; then
    [ -f "${logfile}" ] || { echo "No log for '${SESSION}'." ; return 1 ; } ;
    tail -n +1 -F "${logfile}" &
    local tp=$! ;
    while screen -ls 2>/dev/null | grep -q "[.]${SESSION}[[:space:]]" ; do sleep 3 ; done ;
    sleep 1 ; kill "${tp}" 2>/dev/null ;
    echo "" ; echo "--- '${SESSION}' ended ---" ;
    return 0 ;
  fi

  if [ "${LOG}" == 'yes' ] ; then
    [ -f "${logfile}" ] || { echo "No log for '${SESSION}'." ; return 1 ; } ;
    cat "${logfile}" ;
    return 0 ;
  fi

  echo "Nothing to do: give --run, --follow, --log, --stop, or --list." ;
  return 1 ;
}
