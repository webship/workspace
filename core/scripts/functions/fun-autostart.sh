#!/usr/bin/env bash

# The dashboard's own hostname, and getting it back after a reboot.
#
# Two problems that look like one. A DDEV project's containers carry `restart: no`, so nothing brings
# the dashboard back when the machine boots or when Docker restarts — `ddev describe` says `exited`
# and every workspace URL answers 404 from a router with nothing behind it. And a project answers only
# on the names DDEV knows about, so a name of your own choosing has to be given to it.
#
# WHY NOT A DOCKER RESTART POLICY. Setting `restart: unless-stopped` on the containers looks like the
# smaller fix and is the wrong one: DDEV rebuilds its containers on `ddev start` and pushes fresh
# router config each time, so a container resurrected behind DDEV's back comes up without a router
# entry and answers nothing. The supported way in is `ddev start`, so that is what runs at boot.
#
# A **user** service, not a system one. The projects live under $HOME, the Docker socket is reached
# with this user's group membership, and `ddev` reads ~/.ddev. A root unit would start them as the
# wrong user and strand every volume. Lingering (`loginctl enable-linger`) is what makes a user
# service run at BOOT rather than at first login — without it the dashboard would only appear once
# somebody signs in, which defeats the point.

readonly AUTOSTART_UNIT_NAME="webship-workspace.service";
readonly AUTOSTART_UNIT_DIR="${HOME}/.config/systemd/user";
readonly AUTOSTART_RUNNER="${WORKSPACE_SCRIPTS}/autostart-run.sh";
readonly AUTOSTART_RECORDER="${WORKSPACE_SCRIPTS}/autostart-stop.sh";
readonly AUTOSTART_WATCHER="${WORKSPACE_SCRIPTS}/autostart-watch.sh";
readonly AUTOSTART_WATCH_NAME="webship-workspace-watch";

# The dashboard's own DDEV project. Everything else in the tree is a site; this one is the way in.
function autostart_app_path() {
  printf '%s' "${WORKSPACE_PATH}/workspace-app";
}

# Which projects the boot service starts, resolved. Asks the runner rather than re-deriving it: the
# setting is a small vocabulary (`workspace`, `running`, `all`, or literal names) and a second copy of
# that logic here would drift from the one that actually runs at boot.
function autostart_projects() {
  bash "${AUTOSTART_RUNNER}" --list 2>/dev/null ;
}

# The one name the dashboard answers on, as `<project>.<tld>`.
#
# `hub_domain`, the key the app ALREADY uses — workspaces.js reads it for every URL it builds, and
# urls.js derives the whole scheme from it. A second key here would be the same fact stored twice:
# set one, and the dashboard's links and DDEV's routing would disagree about where the site is. So
# this command reads and writes that one, and its job is to make DDEV agree with it.
function autostart_domain() {
  printf '%s' "${hub_domain:-workspace.ddev.site}";
}

# Rewrite one `key: value` line in the dashboard block of the settings file, in place.
#
# In place, and only that line: this file holds the real account password and the API keys on a live
# machine, it is never synced or committed, and a regenerating writer would reformat around secrets it
# has no business touching. One sed on one key is the whole edit.
function autostart_settings_write() {
  local key="$1" value="$2" file="${WORKSPACE_CONFIG}/settings.yml";
  [ -f "${file}" ] || { echo "No ${file}."; return 1 ; }

  # Two shapes, because the two keys live at different levels: hub_domain is top-level (the app has
  # always read it there), autostart is nested under dashboard:.
  #
  # Written UNQUOTED and at two spaces, because that is what every other value in this file does.
  # parse_yaml strips quotes either way, so quoting was never a correctness question — it just left
  # one block looking unlike the file it lives in, which is how a hand-edit later gets it wrong.
  case "${key}" in
    hub_domain)
      if grep -qE "^${key}:" "${file}" ; then
        # `#` as the sed delimiter: `|` and `/` both appear in things people paste here.
        sed -i -E "s#^${key}:.*#${key}: ${value}#" "${file}" ;
      else
        printf '\n# The base domain every dashboard URL is built from, and what DDEV routes.\n# Kept in step with DDEV by core/scripts/autostart.sh.\n%s: %s\n' "${key}" "${value}" >> "${file}" ;
      fi
      ;;
    *)
      if grep -qE "^  ${key}:" "${file}" ; then
        sed -i -E "s#^  ${key}:.*#  ${key}: ${value}#" "${file}" ;
      elif grep -qE '^dashboard:' "${file}" ; then
        sed -i -E "/^dashboard:/a\\  ${key}: ${value}" "${file}" ;
      else
        printf '\ndashboard:\n  %s: %s\n' "${key}" "${value}" >> "${file}" ;
      fi
      ;;
  esac
}

# Does this TLD answer for names nobody has put in /etc/hosts?
#
# This is the whole question, and it is why the default is ddev.site rather than something branded.
# `*.ddev.site` is wildcard DNS pointing at 127.0.0.1 AT ANY DEPTH — `x.dev.workspace.ddev.site`
# resolves with an empty hosts file — which is the only reason this tree's nested scheme
# (<project>.<workspace>.workspace.<tld>) works at all.
#
# A TLD without that has to be written into /etc/hosts, and **/etc/hosts cannot hold wildcards**. Every
# nested name would need its own line, DDEV would ask for sudo on every start, and each new project
# would silently 404 until someone added it by hand. So a TLD that does not resolve is refused rather
# than half-applied, and --force is there for the case where you run your own wildcard DNS.
function autostart_tld_resolves() {
  local tld="$1" probe ;
  probe="ddev-probe-$$.${tld}";
  getent hosts "${probe}" > /dev/null 2>&1 ;
}

# Hand the name to DDEV rather than editing any config.yaml. `ddev config global --project-tld` is the
# supported writer and it sets the DEFAULT FOR EVERY PROJECT — the dashboard, every workspace page
# under it, and each project's own <project>.<tld> — which is what makes this one field rather than
# forty. Hand-editing that YAML is how a project stops parsing.
function autostart_apply_domain() {
  local app ; app="$(autostart_app_path)";
  local domain ; domain="$(autostart_domain)";
  local want_name want_tld current_name ;

  [ -d "${app}/.ddev" ] || { echo "No DDEV project at ${app}."; return 1 ; }

  want_name="${domain%%.*}";
  want_tld="${domain#*.}";
  current_name="$(grep -E '^name:' "${app}/.ddev/config.yaml" | head -1 | sed -E 's/^name:[[:space:]]*//')";

  if [ -z "${want_tld}" ] || [ "${want_tld}" == "${domain}" ] ; then
    echo "   '${domain}' has no TLD — it should look like workspace.ddev.site." ;
    return 1 ;
  fi

  # A rename is not a domain change: DDEV keys its volumes, containers and router entries on the
  # project name, so renaming strands the old database volume and builds a fresh empty one.
  if [ "${want_name}" != "${current_name}" ] ; then
    if [ "${FORCE}" == 'yes' ] ; then
      echo "   renaming the project ${current_name} -> ${want_name} (--force)." ;
      echo "   the old volumes stay behind; find them later with cmd-tools-reclaim.sh." ;
    else
      echo "   '${domain}' would rename the project ${current_name} -> ${want_name}." ;
      echo "   That strands its database volume and builds an empty one, so it is refused here." ;
      echo "   Keep the first label as '${current_name}', or pass --force if you meant it." ;
      return 1 ;
    fi
  fi

  if ! autostart_tld_resolves "${want_tld}" ; then
    if [ "${FORCE}" == 'yes' ] ; then
      echo "   '${want_tld}' has no wildcard DNS — going ahead anyway (--force)." ;
      echo "   DDEV will ask for sudo and write /etc/hosts, and nested names will NOT work." ;
    else
      echo "   '${want_tld}' does not resolve: a name under it answers nothing." ;
      echo "" ;
      echo "   ddev.site is wildcard DNS to 127.0.0.1 at any depth, which is what makes" ;
      echo "   <project>.<workspace>.workspace.<tld> work with an empty /etc/hosts." ;
      echo "   /etc/hosts cannot hold wildcards, so a TLD without its own DNS needs one line" ;
      echo "   per hostname, added by hand, with sudo, forever." ;
      echo "" ;
      echo "   Point *.${want_tld} at 127.0.0.1 in your DNS first, then pass --force." ;
      return 1 ;
    fi
  fi

  echo "   applying: ${want_name}.${want_tld}  (project '${want_name}', TLD '${want_tld}')" ;

  # GLOBAL, not per-project, and that is the whole point of setting it here.
  #
  # Every project in this tree inherits `project-tld` from DDEV's global config — none of them carry
  # their own — so one global setting moves the dashboard, every workspace page under it, and every
  # project's canonical <project>.<tld> together. A per-project override on the dashboard instead
  # would move workspace.<tld> and leave all 40-odd sites answering on ddev.site, with the dashboard's
  # own Launch buttons pointing at hostnames that no longer exist.
  ddev config global --project-tld="${want_tld}" > /dev/null || return 1 ;

  # A per-project override beats the global one, so name the projects that will not follow rather
  # than leaving someone to wonder why their site did not move.
  local overrides ;
  overrides="$(find "${WORKSPACE_ROOT}" -mindepth 2 -maxdepth 4 -name config.yaml -path '*/.ddev/*' 2>/dev/null \
    | xargs grep -l '^project_tld' 2>/dev/null | sed 's|/.ddev/config.yaml||; s|.*/||' | paste -sd' ' -)";
  [ -n "${overrides}" ] && echo "   note: these set their own project_tld and will NOT follow: ${overrides}" ;

  # Laptop or hub. On ddev.site the router binds 127.0.0.1 and that is correct — the sites are for
  # the person sitting here. A real TLD means this is a shared workspace on a Docker host or a
  # dedicated server, where binding to loopback makes it reachable by nobody: the port is open, the
  # DNS resolves, and every request from outside the box times out with nothing in any log. So the
  # bind is widened to match, and said out loud, because it is the one change here that exposes
  # something to the network.
  if [ "${want_tld}" != 'ddev.site' ] ; then
    if [ "$(ddev config global 2>/dev/null | grep -c 'router-bind-all-interfaces=true')" -eq 0 ] ; then
      echo "" ;
      echo "   '${want_tld}' is a real domain, so this is a shared hub rather than a laptop." ;
      echo "   The router is bound to 127.0.0.1 and nothing outside this machine can reach it." ;
      if [ "${FORCE}" == 'yes' ] ; then
        ddev config global --router-bind-all-interfaces=true > /dev/null 2>&1 \
          && echo "   opened the router to all interfaces (--force)." ;
        echo "   EVERY DDEV project on this machine is now reachable from the network." ;
        echo "   Put it behind a firewall or a reverse proxy, and remember the sites are dev sites." ;
      else
        echo "   Open it deliberately, once you have a firewall in front:" ;
        echo "     ddev config global --router-bind-all-interfaces=true" ;
        echo "   (or re-run this with --force). Left closed for now — the domain change still applied." ;
      fi
      echo "" ;
    fi
  fi

  # A TLD only reaches the router after a restart — router config is pushed on start.
  echo "   restarting the dashboard so the router learns it…" ;
  ( cd "${app}" && ddev restart > /dev/null 2>&1 ) || {
    echo "   ddev restart failed. If it asked for a sudo password, run it yourself:" ;
    echo "     cd ${app} && ddev restart" ;
    return 1 ;
  }

  # Every other running project still answers on the OLD name until it restarts too: its containers
  # were started against the previous TLD and the router holds no entry for the new one. Listed
  # rather than done silently — restarting a site mid-build is how a half-written database happens,
  # and there can be forty of them.
  local stale ;
  stale="$(ddev list --json-output 2>/dev/null \
    | jq -r --arg n "${want_name}" '.raw[]? | select(.status=="running") | select(.name != $n) | .name' 2>/dev/null \
    | paste -sd' ' -)";
  if [ -n "${stale}" ] ; then
    echo "" ;
    echo "   Running, and still on the old TLD until they restart:" ;
    printf '     %s\n' ${stale} ;
    if [ "${RESTART_ALL}" == 'yes' ] ; then
      echo "   restarting them (--restart-all)…" ;
      local one root ;
      for one in ${stale} ; do
        root="$(ddev list --json-output 2>/dev/null \
          | jq -r --arg n "${one}" '.raw[]? | select(.name==$n) | .approot' 2>/dev/null | head -1)";
        [ -d "${root}" ] || continue ;
        ( cd "${root}" && ddev restart > /dev/null 2>&1 ) \
          && echo "     restarted ${one}" || echo "     FAILED ${one}" ;
      done
    else
      echo "   Restart them when nothing is mid-build:" ;
      echo "     bash core/scripts/autostart.sh --apply --restart-all" ;
    fi
  fi
  return 0 ;
}

function autostart_write_unit() {
  mkdir -p "${AUTOSTART_UNIT_DIR}" ;

  # Type=oneshot + RemainAfterExit: `ddev start` returns when the containers are up, and the unit
  # should then read as active rather than dead. The long timeout is not padding — a first start after
  # an update rebuilds images, and systemd killing that halfway leaves a broken project.
  cat > "${AUTOSTART_UNIT_DIR}/${AUTOSTART_UNIT_NAME}" <<UNITEOF
[Unit]
Description=Webship Workspace — start the dashboard and its projects
Documentation=https://github.com/webship/workspace
After=network-online.target
Wants=network-online.target
# The window StartLimitBurst counts failures IN, and it belongs HERE in [Unit] — systemd accepts
# StartLimitBurst under [Service] too for compatibility, but silently ignored StartLimitIntervalSec
# there ("Unknown key name", ddev-workspace ran on the default 10s window for a day before this was
# caught). The window has to be wider than RestartSec * StartLimitBurst below, or the burst limit
# can never be reached and this restarts forever: 3 tries at 20s apart span 60s, so 150s leaves room
# for that plus the first attempt's own startup time. Below this, a genuinely broken start (bad
# config, a Docker daemon that never recovers) retries forever rather than failing after three
# tries — silently rebuilding project images on every attempt, which is the same failure shape as
# the disk filling up from unrelated builds.
StartLimitIntervalSec=150
StartLimitBurst=3

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/bash ${AUTOSTART_RUNNER}
# Records what was running, so 'autostart: running' has something to restore. RemainAfterExit means
# this fires on shutdown and reboot rather than the instant ExecStart returns.
ExecStop=/bin/bash ${AUTOSTART_RECORDER}
TimeoutStartSec=900
TimeoutStopSec=60
# Docker may not be accepting connections the instant the user session starts.
Restart=on-failure
RestartSec=20

[Install]
WantedBy=default.target
UNITEOF
  echo "   wrote ${AUTOSTART_UNIT_DIR}/${AUTOSTART_UNIT_NAME}" ;
}

# The boot service runs once. A Docker restart AFTER login stops every container and nothing starts them
# again; this timer looks every two minutes and runs the same start script when Docker has restarted.
function autostart_write_watch() {
  mkdir -p "${AUTOSTART_UNIT_DIR}" ;
  cat > "${AUTOSTART_UNIT_DIR}/${AUTOSTART_WATCH_NAME}.service" <<UNITEOF
[Unit]
Description=Webship Workspace — start the dashboard again after Docker restarts
Documentation=https://github.com/webship/workspace

[Service]
Type=oneshot
ExecStart=/bin/bash ${AUTOSTART_WATCHER}
TimeoutStartSec=900
UNITEOF
  cat > "${AUTOSTART_UNIT_DIR}/${AUTOSTART_WATCH_NAME}.timer" <<UNITEOF
[Unit]
Description=Webship Workspace — look for a Docker restart every two minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
AccuracySec=15s

[Install]
WantedBy=timers.target
UNITEOF
  echo "   wrote ${AUTOSTART_UNIT_DIR}/${AUTOSTART_WATCH_NAME}.{service,timer}" ;
}

function autostart_enable() {
  command -v systemctl > /dev/null 2>&1 || { echo "No systemctl here — nothing to install."; return 1 ; }

  autostart_write_unit ;
  systemctl --user daemon-reload ;
  systemctl --user enable "${AUTOSTART_UNIT_NAME}" > /dev/null 2>&1 ;
  autostart_write_watch ;
  systemctl --user daemon-reload ;
  systemctl --user enable --now "${AUTOSTART_WATCH_NAME}.timer" > /dev/null 2>&1 \
    && echo "   watching for a Docker restart (every two minutes)" ;

  # Lingering is the difference between "starts at boot" and "starts when Rajab logs in". Without it
  # the dashboard is missing until someone signs in, which is exactly the problem being solved.
  if command -v loginctl > /dev/null 2>&1 ; then
    if [ "$(loginctl show-user "${USER}" -p Linger --value 2>/dev/null)" != 'yes' ] ; then
      echo "   enabling lingering so it starts at BOOT, not at login (needs sudo once)…" ;
      sudo loginctl enable-linger "${USER}" 2>/dev/null \
        && echo "   lingering on" \
        || { echo "   could not enable lingering — run this once yourself:" ;
             echo "     sudo loginctl enable-linger ${USER}" ;
             echo "   until then the dashboard starts at login rather than at boot." ; }
    else
      echo "   lingering already on" ;
    fi
  fi
  echo "   enabled — it will run on the next boot. Prove it now with --now." ;
}

function autostart_disable() {
  command -v systemctl > /dev/null 2>&1 || return 0 ;
  systemctl --user disable --now "${AUTOSTART_UNIT_NAME}" > /dev/null 2>&1 ;
  systemctl --user disable --now "${AUTOSTART_WATCH_NAME}.timer" > /dev/null 2>&1 ;
  rm -f "${AUTOSTART_UNIT_DIR}/${AUTOSTART_UNIT_NAME}" "${AUTOSTART_UNIT_DIR}/${AUTOSTART_WATCH_NAME}.service" "${AUTOSTART_UNIT_DIR}/${AUTOSTART_WATCH_NAME}.timer" ;
  systemctl --user daemon-reload ;
  echo "   removed. Projects are not touched; they keep running." ;
  echo "   Lingering was left on — turn it off with:  sudo loginctl disable-linger ${USER}" ;
}

function autostart_status() {
  local app ; app="$(autostart_app_path)";
  local unit_state linger ;

  unit_state="$(systemctl --user is-enabled "${AUTOSTART_UNIT_NAME}" 2>/dev/null)";
  case "${unit_state}" in ''|not-found) unit_state='not installed' ;; esac ;
  linger="$(loginctl show-user "${USER}" -p Linger --value 2>/dev/null || echo '?')";

  echo "" ;
  echo "── Autostart ────────────────────────────────────────────────────────" ;
  printf "   boot service : %s\n" "${unit_state}" ;
  printf "   lingering    : %s%s\n" "${linger}" "$([ "${linger}" == 'yes' ] && echo '' || echo '  (without it, starts at login not at boot)')" ;
  printf "   setting      : %s\n" "${dashboard_autostart:-workspace}" ;
  printf "   will start   : %s\n" "$(autostart_projects | paste -sd' ' -)" ;
  local domain tld ; domain="$(autostart_domain)" ; tld="${domain#*.}" ;
  printf "   domain       : %s\n" "${domain}" ;
  local global_tld ; global_tld="$(ddev config global 2>/dev/null | sed -n 's/^project-tld=//p')" ;
  if [ "${global_tld}" == "${tld}" ] ; then
    printf "   DDEV TLD     : %s — global, so every project inherits it\n" "${global_tld}" ;
  else
    printf "   DDEV TLD     : %s in DDEV vs %s in settings — run --apply to line them up\n" "${global_tld:-unset}" "${tld}" ;
  fi
  if autostart_tld_resolves "${tld}" ; then
    printf "   TLD DNS      : *.%s resolves on its own — no /etc/hosts needed\n" "${tld}" ;
  else
    printf "   TLD DNS      : *.%s does NOT resolve — every name needs an /etc/hosts line\n" "${tld}" ;
  fi
  if [ "${tld}" == 'ddev.site' ] ; then
    printf "   reachable    : this machine only (ddev.site, router on 127.0.0.1)\n" ;
  elif ddev config global 2>/dev/null | grep -q 'router-bind-all-interfaces=true' ; then
    printf "   reachable    : from the network — shared hub, router on all interfaces\n" ;
  else
    printf "   reachable    : this machine only — a real TLD but the router is still on 127.0.0.1\n" ;
    printf "                  open it with: ddev config global --router-bind-all-interfaces=true\n" ;
  fi
  echo "" ;
  echo "   DDEV sees:" ;
  ( cd "${app}" 2>/dev/null && ddev describe 2>/dev/null \
      | awk -F'│' '/web|Project:/ {gsub(/^[ \t]+|[ \t]+$/,"",$2); if ($2 != "") printf "     %s\n", $2}' | head -3 ) \
    || echo "     (no project at ${app})" ;
  echo "" ;
  echo "   Every URL the dashboard answers on:" ;
  ( cd "${app}" 2>/dev/null && ddev describe -j 2>/dev/null \
      | jq -r '.raw.urls[]?' 2>/dev/null | grep '^https' | sed 's/^/     /' | head -12 ) ;
  echo "" ;
}

function autostart_command() {
  local changed=0 ;

  if [ ! "${DOMAIN}" == '_none_' ] ; then
    # Hold it in the variable the apply step reads, but do NOT write the file yet — a refused domain
    # must not end up recorded as the truth. The write happens below, only once DDEV took it.
    hub_domain="${DOMAIN}";
    changed=1 ;
  fi

  [ "${APPLY}" == 'yes' ] && changed=1 ;

  if [ "${changed}" -eq 1 ] ; then
    echo "" ;
    echo "→ applying the domain to the dashboard project" ;
    autostart_apply_domain || { echo "   nothing was changed, in DDEV or in the settings." ; return 1 ; }
    if [ ! "${DOMAIN}" == '_none_' ] ; then
      autostart_settings_write 'hub_domain' "${DOMAIN}" || return 1 ;
      echo "   domain is now: ${DOMAIN}" ;
    fi
    echo "   done" ;
  fi

  if [ "${ENABLE}" == 'yes' ] ; then
    echo "" ; echo "→ installing the boot service" ; autostart_enable || return 1 ;
  fi

  if [ "${DISABLE}" == 'yes' ] ; then
    echo "" ; echo "→ removing the boot service" ; autostart_disable ;
  fi

  if [ "${NOW}" == 'yes' ] ; then
    echo "" ; echo "→ running exactly what the boot service runs" ;
    bash "${AUTOSTART_RUNNER}" || return 1 ;
  fi

  autostart_status ;
}
