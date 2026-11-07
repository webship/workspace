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
##   bash core/scripts/plugins.sh --restart                    restart the dashboard app, so it loads the change
##
## A plugin is a node package with a `workspacePlugin` manifest in its package.json, kept in its
## own repository (github.com/webship/workspace-<name>). The four steps are what it takes to turn a
## feature on; --list shows which step a plugin is at. --install is idempotent and says when the
## dashboard container needs `ddev restart` (a compose file or host mount it brought).

set -u
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${WORKSPACE_SCRIPTS}/../.." && pwd)}";
APP="${WORKSPACE_ROOT}/core/workspace-app";
SETTINGS="${WORKSPACE_ROOT}/core/config/settings.yml";

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^## \{0,1\}//'; }

# Inside the dashboard container the app runs supervised; on the host there is nothing to restart but
# the container's process, reached through docker.
restart_app() {
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

verb="${1:-}"; name="${2:-}";
case "${verb}" in
  -h|--help|'') usage ; exit 0 ;;

  --list)
    echo "Plugins the dashboard can see (core/workspace-app), and where each one is:" ;
    ( cd "${APP}" && node -e '
      const { installedPlugins } = require("./plugin-manifest");
      const { status } = require("./plugin-install");
      const yaml = require("js-yaml"); const fs = require("fs");
      let settings = {}; try { settings = yaml.load(fs.readFileSync("../config/settings.yml", "utf8")) || {}; } catch (_) {}
      const on = settings.plugins || {};
      const placed = Object.fromEntries(status().map((s) => [s.name, s]));
      for (const p of installedPlugins()) {
        const cfg = on[p.name] || {};
        const active = cfg.enabled === true || String(cfg.enabled) === "true";
        const st = placed[p.name] || {};
        const step = !active ? "required · not activated" : !st.installed ? "activated · not installed" : st.settingsFile === false ? "installed · not configured" : "ready";
        console.log(`  ${p.name.padEnd(14)} ${(p.module || "-").padEnd(34)} ${(p.version || "").padEnd(8)} ${step}${st.missing && st.missing.length ? ` (missing ${st.missing.length} placed file(s): run --install again)` : ""}`);
      }
    ' ) ;;

  --require)
    [ -n "${name}" ] || { echo "Which package? e.g. --require github:webship/workspace-upsun" ; exit 1 ; } ;
    echo "→ npm install ${name} (core/workspace-app)" ;
    # The plugin repositories are private: let git borrow the gh CLI's login for github.com, the way
    # the commands tooling does, so a github: spec resolves without a token in the environment.
    if command -v gh > /dev/null 2>&1 && gh api user --jq .login > /dev/null 2>&1 ; then
      export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="credential.https://github.com.helper" GIT_CONFIG_VALUE_0="!gh auth git-credential" ;
    fi
    ( cd "${APP}" && npm install --no-audit --no-fund "${name}" ) || exit 1 ;
    echo "Required. Next: --activate <name> (the name is the manifest's: --list shows it)." ;;

  --activate)
    [ -n "${name}" ] || { echo "Which plugin? --list shows them." ; exit 1 ; } ;
    plugin_known "${name}" || { echo "No plugin named '${name}' is installed in the dashboard. --require it first." ; exit 1 ; } ;
    module="$(plugin_module "${name}")" ;
    set_plugin_setting "${name}" enabled true ;
    [ -n "${module}" ] && set_plugin_setting "${name}" module "${module}" ;
    echo "Activated: plugins.${name} in core/config/settings.yml. Next: --install ${name}." ;;

  --deactivate)
    [ -n "${name}" ] || { echo "Which plugin?" ; exit 1 ; } ;
    set_plugin_setting "${name}" enabled false ;
    echo "Deactivated: plugins.${name}.enabled: false. Its files stay; --uninstall removes them." ;
    restart_app ;;

  --install)
    [ -n "${name}" ] || { echo "Which plugin? --list shows them." ; exit 1 ; } ;
    out="$( cd "${APP}" && node plugin-install.js install "${name}" )" || { echo "${out}" ; exit 1 ; } ;
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
    ( cd "${APP}" && node plugin-install.js uninstall "${name}" ) | grep -v '^RESTART_' ;
    set_plugin_setting "${name}" enabled false ;
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
