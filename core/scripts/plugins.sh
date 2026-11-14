#!/usr/bin/env bash
## Plugins of the Webship Workspace dashboard: require, activate, install, configure.
##
##   bash core/scripts/plugins.sh --list                       what is installed, activated, placed
##   bash core/scripts/plugins.sh --require <npm spec>         npm install into the dashboard
##                                                             (github:webship/workspace-upsun, a tarball, a path)
##   bash core/scripts/plugins.sh --activate <name>            plugins.<name>.enabled: true in settings.yml
##   bash core/scripts/plugins.sh --install <name>             place what its manifest names in the workspace
##   bash core/scripts/plugins.sh --configure <name>           its own settings file, created from the template
##   bash core/scripts/plugins.sh --deactivate <name>          enabled: false (the files stay)
##   bash core/scripts/plugins.sh --uninstall <name>           remove what --install placed
##   bash core/scripts/plugins.sh --check [<name>]             the commands the core and the plugins need on this
##                                                             machine: found, with the version, or missing, with
##                                                             how to install it (nothing is installed for you)
##   bash core/scripts/plugins.sh --restart                    restart the dashboard app, so it loads the change
##
## A plugin may need another plugin (its manifest's `needs`: a sites folder for a builder, the AI Agents
## folder for its agents). --require says what it needs; --activate and --install stop, with the exact
## commands, until the workspace has it. Add --with-needs to any of the three and what is missing is
## required, activated and installed first, in the same run. --deactivate and --uninstall refuse while
## another plugin in use needs this one. --list shows each plugin's needs and whether they are met.
##
## A plugin is a node package with a `workspacePlugin` manifest in its package.json, kept in its
## own repository (github.com/webship/workspace-<name>). The four steps are what it takes to turn a
## feature on; --list shows which step a plugin is at. --install is idempotent and says when the
## dashboard container needs `ddev restart` (a compose file or host mount it brought).

set -u
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${WORKSPACE_SCRIPTS}/../.." && pwd)}";
# The dashboard app lives beside these scripts (not necessarily under WORKSPACE_ROOT: a test points the
# root at a temporary tree while the code stays here).
APP="$(cd "${WORKSPACE_SCRIPTS}/../workspace-app" && pwd)";
SETTINGS="${WORKSPACE_ROOT}/core/config/settings.yml";

usage() { awk 'NR > 1 && !/^##/ { exit } NR > 1 { sub(/^## ?/, ""); print }' "${BASH_SOURCE[0]}"; }

# Inside the dashboard container the app runs supervised; on the host there is nothing to restart but
# the container's process, reached through docker.
restart_app() {
  # A test drives these verbs against a temporary tree; it must never restart the dashboard that serves.
  [ -n "${WORKSPACE_PLUGINS_NO_RESTART:-}" ] && return 0 ;
  if command -v supervisorctl > /dev/null 2>&1 && supervisorctl status webextradaemons:workspace-app > /dev/null 2>&1 ; then
    supervisorctl restart webextradaemons:workspace-app ;
  elif command -v docker > /dev/null 2>&1 ; then
    docker exec ddev-workspace-web supervisorctl restart webextradaemons:workspace-app 2>/dev/null \
      || echo "The dashboard is not running; it will load the change when it starts." ;
  fi
}

# One settings.yml edit, through the same code the Settings page uses, so comments survive.
set_plugin_setting() {
  local name="$1" key="$2" value="$3" ;
  ( cd "${APP}" && node -e '
    const [name, key, value] = process.argv.slice(1);
    const { upsertSettingsValue } = require("./settings-file");
    upsertSettingsValue("settings.yml", `plugins.${name}.${key}`, value === "true" ? true : value === "false" ? false : value);
  ' "${name}" "${key}" "${value}" ) ;
}

plugin_module() { ( cd "${APP}" && node plugin-manifest.js --json "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s||"null");process.stdout.write(p&&p.module?p.module:"")})' ) ; }
plugin_known()  { ( cd "${APP}" && node plugin-manifest.js "$1" > /dev/null 2>&1 ) ; }
# A plugin that IS a workspace folder names it in its manifest (workspace.key); activating it puts the
# key on settings.yml's workspaces list (the dashboard's order), deactivating takes it off.
plugin_workspace_key() { ( cd "${APP}" && node plugin-manifest.js --json "$1" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s||"null");const w=p&&p.manifest&&p.manifest.workspace;process.stdout.write(w&&w.key?String(w.key):"")})' ) ; }
set_workspaces_list() {
  local verb="$1" key="$2" ;
  [ -n "${key}" ] || return 0 ;
  ( cd "${APP}" && node -e '
    const [verb, key] = process.argv.slice(1);
    const { upsertSettingsList } = require("./settings-file");
    const { loadSettings } = require("./workspaces");
    const now = (loadSettings().workspaces || []).map(String);
    const next = verb === "add" ? (now.includes(key) ? now : [...now, key]) : now.filter((k) => k !== key);
    if (next.join(",") !== now.join(",")) upsertSettingsList("settings.yml", "workspaces", next);
    process.stdout.write(verb === "add" ? (now.includes(key) ? "" : `Workspace ${key} added to the workspaces list.\n`) : (now.includes(key) ? `Workspace ${key} taken off the workspaces list (the folder and its settings stay).\n` : ""));
  ' "${verb}" "${key}" ) ;
}

# ── What a plugin needs from another plugin (core/workspace-app/plugin-needs.js) ────────────────────
SELF="${BASH_SOURCE[0]}";
needs_lines()   { ( cd "${APP}" && node plugin-needs.js lines "$1" 2>/dev/null ) ; }
needs_say()     { ( cd "${APP}" && node plugin-needs.js say "$1" 2>/dev/null ) ; }
needed_by()     { ( cd "${APP}" && node plugin-needs.js dependents "$1" 2>/dev/null ) ; }
plugin_names()  { ( cd "${APP}" && node plugin-manifest.js 2>/dev/null | cut -f1 | sort ) ; }
plugin_active() { ( cd "${APP}" && node -e 'process.exit(require("./plugin-needs").state().active.has(process.argv[1]) ? 0 : 1)' "$1" 2>/dev/null ) ; }

# The same script for a plugin this one needs: never a restart of its own (the outer run does one), and
# the chain of names that led here, so a cycle found after a package was fetched stops instead of looping.
sub() { WORKSPACE_PLUGINS_NEEDS_CHAIN="${WORKSPACE_PLUGINS_NEEDS_CHAIN:-} ${name}" WORKSPACE_PLUGINS_NO_RESTART=1 bash "${SELF}" "$@" ; }

# Bring one needed plugin all the way: required, activated, installed (and what IT needs, first).
ensure_plugin() {
  local need="$1" spec="$2" ;
  case " ${WORKSPACE_PLUGINS_NEEDS_CHAIN:-} ${name} " in
    *" ${need} "*) echo "A cycle of needs:${WORKSPACE_PLUGINS_NEEDS_CHAIN:-} ${name} → ${need}. None of them can be added before the other; fix the manifests." ; return 1 ;;
  esac
  if ! plugin_known "${need}" ; then
    echo "→ ${name} needs ${need}: requiring ${spec}" ;
    sub --require "${spec}" > /dev/null 2>&1 ;
    plugin_known "${need}" || { echo "${name} needs '${need}', and ${spec} could not be required as a plugin of that name (unknown plugin, or no network)." ; return 1 ; } ;
  fi
  echo "→ ${name} needs ${need}: activating and installing it" ;
  sub --activate "${need}" --with-needs | sed 's/^/    /' ; [ "${PIPESTATUS[0]}" -eq 0 ] || return 1 ;
  # The list of what it placed is in plugins.installed.yml; here, the count and whatever else it said.
  sub --install "${need}" --with-needs | awk '/^ *placed /{n++; next} {print "    " $0} END{if (n) print "    placed " n " file(s)"}' ; [ "${PIPESTATUS[0]}" -eq 0 ] || return 1 ;
  added_needs="${added_needs} ${need}" ;
}

# Before an activate or an install of ${name}: 0 when its needs are met (or were added), 1 with the
# reason and the exact commands when they are not. $1 is the verb and $2 its past form, for the wording.
resolve_needs() {
  local doing="$1" done="$2" lines unmet problems answer pick state have spec rest ;
  lines="$(needs_lines "${name}")" ;
  problems="$(echo "${lines}" | grep '^PROBLEM ' | sed 's/^PROBLEM /  /')" ;
  if [ -n "${problems}" ] ; then
    echo "${name} cannot be ${done}: its manifest's needs are wrong." ; echo "${problems}" ; return 1 ;
  fi
  unmet="$(echo "${lines}" | grep '^NEED ' | awk '$3 == "unmet"')" ;
  [ -n "${unmet}" ] || return 0 ;
  echo "${name} needs what this workspace does not have yet:" ;
  needs_say "${name}" | grep ' needs ' | grep 'not here' | sed "s/^  ${name} needs /  /" ;
  if [ -z "${with_needs}" ] && [ -t 0 ] && [ -t 1 ] ; then
    printf 'Add %s now (require, activate, install)? [y/N] ' "$(echo "${unmet}" | awk '{print $2}' | paste -sd, - | sed 's/,/, /g')" ;
    read -r answer ;
    case "${answer}" in y|Y|yes|YES) with_needs=1 ;; esac
  fi
  if [ -z "${with_needs}" ] ; then
    echo "Nothing was changed: ${name} was not ${done}. Add what it needs first:" ;
    while read -r _ pick state have spec rest ; do
      [ "${have}" = "missing" ] && echo "  bash core/scripts/plugins.sh --require ${spec}" ;
      echo "  bash core/scripts/plugins.sh --activate ${pick}" ;
      echo "  bash core/scripts/plugins.sh --install ${pick}" ;
    done <<< "${unmet}" ;
    echo "or all of it in one run:" ;
    echo "  bash core/scripts/plugins.sh --${doing} ${name} --with-needs" ;
    return 1 ;
  fi
  while read -r _ pick state have spec rest ; do
    ensure_plugin "${pick}" "${spec}" || {
      echo "Stopped: ${name} was not ${done}.${added_needs:+ Added before the stop:${added_needs} (each one complete on its own).}" ;
      return 1 ;
    } ;
  done <<< "${unmet}" ;
  return 0 ;
}

# The commands ${name} needs on this machine that are missing, said before a step starts. It never
# stops the step: a command is installed outside the workspace, and the plugin's files can be placed first.
say_missing_commands() {
  local missing ;
  missing="$( cd "${APP}" && node command-check.js "${name}" --missing 2>/dev/null )" ;
  [ -n "${missing}" ] || return 0 ;
  echo "Commands ${name} uses that are not on this machine (nothing is installed for you):" ;
  echo "${missing}" ;
}

# Who needs ${name} and would be left without: the refusal of a deactivate or an uninstall.
refuse_if_needed() {
  local doing="$1" who ;
  who="$(needed_by "${name}")" ;
  [ -n "${who}" ] || return 0 ;
  echo "${name} cannot be ${doing}: another plugin in use needs it." ;
  echo "${who}" | awk -F'\t' -v n="${name}" '{ printf "  %s needs %s, and %s is the only one here\n", $1, $2, n }' ;
  echo "Nothing was changed. Take those off first:" ;
  echo "${who}" | cut -f1 | sort -u | sed 's|^|  bash core/scripts/plugins.sh --uninstall |' ;
  return 1 ;
}

verb="${1:-}"; name=""; with_needs=""; added_needs="";
for arg in "${@:2}" ; do
  case "${arg}" in
    --with-needs) with_needs=1 ;;
    *) [ -z "${name}" ] && name="${arg}" ;;
  esac
done
case "${verb}" in
  -h|--help|'') usage ; exit 0 ;;

  --list)
    echo "Plugins the dashboard can see (core/workspace-app), and the step each is at:" ;
    ( cd "${APP}" && node -e '
      const { rows, STEPS } = require("./plugins-page");
      for (const p of rows()) {
        const step = p.step >= 3 ? "ready" : `${STEPS[p.step]} · next: ${["activate", "install", "configure"][p.step]}`;
        const missing = p.placed.missing && p.placed.missing.length ? ` (missing ${p.placed.missing.length} placed file(s): --install again)` : "";
        console.log(`  ${p.name.padEnd(18)} ${(p.module || p.spec || "-").padEnd(36)} ${(p.version || "").padEnd(8)} ${step}${missing}`);
        if (p.needsLine) console.log(`  ${"".padEnd(18)} ${p.needsLine}`);
        if (p.neededBy.length) console.log(`  ${"".padEnd(18)} needed by: ${p.neededBy.join(", ")}`);
      }
    ' ) ;;

  --check)
    # Everything (the core and every plugin package), or one plugin. Exit 1 when a needed command is missing.
    ( cd "${APP}" && node command-check.js "${name:-all}" ) ; exit $? ;;

  --require)
    [ -n "${name}" ] || { echo "Which package? e.g. --require github:webship/workspace-upsun" ; exit 1 ; } ;
    echo "→ npm install ${name} (core/workspace-app)" ;
    # The plugin repositories are private: let git borrow the gh CLI's login for github.com, the way
    # the commands tooling does, so a github: spec resolves without a token in the environment.
    if command -v gh > /dev/null 2>&1 && gh api user --jq .login > /dev/null 2>&1 ; then
      export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="credential.https://github.com.helper" GIT_CONFIG_VALUE_0="!gh auth git-credential" ;
    fi
    before="$(plugin_names)" ;
    ( cd "${APP}" && npm install --no-audit --no-fund "${name}" ) || exit 1 ;
    # What this package brought, and what each of those plugins needs from the workspace.
    fresh="$(comm -13 <(echo "${before}") <(plugin_names))" ;
    spec_given="${name}" ;
    for name in ${fresh} ; do
      lines="$(needs_lines "${name}")" ;
      [ -n "${lines}" ] || { say_missing_commands ; continue ; } ;
      echo "${name} declares:" ; needs_say "${name}" ; say_missing_commands ;
      # With --with-needs the packages it needs are fetched too (from the same source); they are
      # activated and installed when this plugin is: --activate ${name} --with-needs.
      if [ -n "${with_needs}" ] ; then
        while read -r kind pick state have spec rest ; do
          [ "${kind}" = "NEED" ] && [ "${have}" = "missing" ] || continue ;
          case " ${WORKSPACE_PLUGINS_NEEDS_CHAIN:-} ${name} " in *" ${pick} "*) continue ;; esac
          echo "→ ${name} needs ${pick}: requiring ${spec}" ;
          sub --require "${spec}" --with-needs > /dev/null 2>&1 ;
          plugin_known "${pick}" || echo "  ${spec} could not be required as a plugin named '${pick}' (unknown plugin, or no network)." ;
        done <<< "${lines}" ;
      elif echo "${lines}" | awk '$1 == "NEED" && $3 == "unmet"' | grep -q . ; then
        echo "  --activate ${name} --with-needs adds what is not here, in the same run." ;
      fi
    done
    name="${spec_given}" ;
    echo "Required. Next: --activate <name> (the name is the manifest's: --list shows it)." ;;

  --activate)
    [ -n "${name}" ] || { echo "Which plugin? --list shows them." ; exit 1 ; } ;
    plugin_known "${name}" || { echo "No plugin named '${name}' is installed in the dashboard. --require it first." ; exit 1 ; } ;
    resolve_needs activate activated || exit 1 ;
    module="$(plugin_module "${name}")" ;
    set_plugin_setting "${name}" enabled true ;
    [ -n "${module}" ] && set_plugin_setting "${name}" module "${module}" ;
    set_workspaces_list add "$(plugin_workspace_key "${name}")" ;
    # A folder that is a workspace from now on gets what the installed plugins place in folders.
    [ -n "$(plugin_workspace_key "${name}")" ] && ( cd "${APP}" && node plugin-install.js reach "${name}" 2>/dev/null ) ;
    echo "Activated: plugins.${name} in core/config/settings.yml. Next: --install ${name}." ;
    # What was added on the way is code the dashboard has not loaded yet.
    [ -n "${added_needs}" ] && restart_app ;
    true ;;

  --deactivate)
    [ -n "${name}" ] || { echo "Which plugin?" ; exit 1 ; } ;
    refuse_if_needed deactivated || exit 1 ;
    set_plugin_setting "${name}" enabled false ;
    set_workspaces_list remove "$(plugin_workspace_key "${name}")" ;
    # A folder that is no longer a workspace here keeps its content, not the other plugins' commands and items.
    [ -n "$(plugin_workspace_key "${name}")" ] && ( cd "${APP}" && node plugin-install.js reach "${name}" 2>/dev/null ) ;
    echo "Deactivated: plugins.${name}.enabled: false. Its files stay; --uninstall removes them." ;
    restart_app ;;

  --install)
    [ -n "${name}" ] || { echo "Which plugin? --list shows them." ; exit 1 ; } ;
    plugin_known "${name}" || { echo "No plugin named '${name}' is installed in the dashboard. --require it first." ; exit 1 ; } ;
    resolve_needs install installed || exit 1 ;
    say_missing_commands ;
    out="$( cd "${APP}" && node plugin-install.js install "${name}" 2>&1 )" || { echo "${out}" ; exit 1 ; } ;
    echo "${out}" | grep -v '^RESTART_' ;
    host="${WORKSPACE_SCRIPTS}/plugins/${name}/host-install.sh" ;
    if [ -f "${host}" ] ; then
      echo "→ the host side (${name}):" ;
      bash "${host}" --check || true ;
    fi
    if echo "${out}" | grep -q '^RESTART_NEEDED' ; then
      echo "" ;
      echo "The dashboard container needs a restart for the compose file or host mount this plugin brought:" ;
      echo "  cd ${APP} && ddev restart" ;
    else
      restart_app ;
    fi
    echo "Installed. Next: --configure ${name}." ;;

  --uninstall)
    [ -n "${name}" ] || { echo "Which plugin?" ; exit 1 ; } ;
    refuse_if_needed uninstalled || exit 1 ;
    # Off the list first, so nothing another plugin places is put back into a folder that is going.
    key="$(plugin_workspace_key "${name}")" ;
    set_workspaces_list remove "${key}" ;
    out="$( cd "${APP}" && node plugin-install.js uninstall "${name}" 2>&1 )" || { echo "${out}" ; set_workspaces_list add "${key}" > /dev/null ; exit 1 ; } ;
    echo "${out}" | grep -v '^RESTART_' ;
    set_plugin_setting "${name}" enabled false ;
    [ -n "${key}" ] && ( cd "${APP}" && node plugin-install.js reach "${name}" 2>/dev/null ) ;
    echo "Uninstalled and deactivated. The package stays in node_modules: npm uninstall <module> in core/workspace-app removes it." ;
    restart_app ;;

  --configure)
    [ -n "${name}" ] || { echo "Which plugin?" ; exit 1 ; } ;
    file="$( cd "${APP}" && node -e 'const p=require("./plugin-manifest").pluginByName(process.argv[1]);process.stdout.write(p&&p.manifest.settingsFile?p.manifest.settingsFile:"")' "${name}" )" ;
    [ -n "${file}" ] || { echo "${name} has no settings file of its own." ; exit 0 ; } ;
    if [ ! -f "${WORKSPACE_ROOT}/core/config/${file}" ] ; then
      ( cd "${APP}" && node plugin-install.js install "${name}" > /dev/null ) ;
    fi
    echo "Its settings: ${WORKSPACE_ROOT}/core/config/${file}" ;
    echo "Edit it there, or on the dashboard: https://workspace.ddev.site/settings/${file}" ;
    sed 's/^\(.*token.*:\).*/\1 <hidden>/' "${WORKSPACE_ROOT}/core/config/${file}" ;;

  --restart) restart_app ;;

  *) usage ; exit 1 ;;
esac
