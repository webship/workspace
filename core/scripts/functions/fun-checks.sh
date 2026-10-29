#!/usr/bin/env bash

# Run the code-quality checks a package ALREADY declares.
#
# Nearly every package in this workspace carries its own quality scripts — `lint:js`, `lint:css`,
# `lint:yaml`, `spellcheck`, `phpcs`, `test:chromium` — and until now nothing ran them from one
# place. This verb reads a package's package.json, maps the names it happens to use onto a fixed set
# of canonical checks, and runs them. It never invents a command: every check is a script the
# package declared for itself.
#
# The map, the safety rule, the package manager and the dependency test all live in ONE place —
# core/scripts/libs/checks_plan.js — which the dashboard also requires for the caption under its
# Checks button. This file does not re-implement any of it; it asks for a plan and executes the rows
# the resolver marked `ready`. That is what stops the button and the command disagreeing.
#
# Everything runs inside DDEV. A site runs its scripts in its own web container. A PACKAGE has no
# DDEV project of its own, so it runs in the dashboard's container, which bind-mounts the whole
# workspace tree at the same absolute path — /home/…/workspace/products/webship_core means the same
# directory inside it and out. There is no host node, no host composer and no raw docker exec.

readonly CHECKS_PLAN_JS="${WORKSPACE_SCRIPTS}/libs/checks_plan.js";
readonly CHECKS_STATE_DIR="${WORKSPACE_PATH}/state/checks";

# Where a project's checks run, and how a command is wrapped to get there.
#
#   site       the project has its own .ddev/config.yaml   -> its own web container
#   here       we are already inside a DDEV web container  -> run in place, do not nest ddev exec
#   dashboard  a package, invoked from the host            -> the dashboard's container
function checks_where() {
  local project_path="$1";
  if [ -f "${project_path}/.ddev/config.yaml" ] ; then printf 'site' ; return 0 ; fi
  if [ -n "${IS_DDEV_PROJECT:-}" ] ; then printf 'here' ; return 0 ; fi
  printf 'dashboard';
}

# One check, run where it belongs. Output streams through unmodified — nothing is swallowed, so the
# dashboard toast shows what a terminal would.
#
# `< /dev/null` on every one of them, and it is not decoration: the caller is a `while read` loop fed
# by a process substitution, and `ddev exec` reads stdin. Without it the first check swallows the
# rest of the plan and the run silently stops after one row — which is exactly what it did. It is the
# same reason every job the dashboard starts closes stdin.
function checks_run_one() {
  local where="$1" project_path="$2" runner="$3" script="$4";
  case "${where}" in
    site)
      ( cd "${project_path}" && ddev exec "${runner} run ${script}" ) < /dev/null ;;
    here)
      ( cd "${project_path}" && bash -lc "${runner} run ${script}" ) < /dev/null ;;
    dashboard)
      ( cd "${WORKSPACE_PATH}/workspace-app" && ddev exec -d "${project_path}" "${runner} run ${script}" ) < /dev/null ;;
  esac
}

# The add-on's own commands, which are already whole checks — used only where the project carries
# github.com/Webship/ddev-dev-tools.
function checks_run_addon() {
  local project_path="$1" command="$2";
  ( cd "${project_path}" && ${command} ) < /dev/null ;
}

# Is the container this project needs actually up? A package with a stopped dashboard container has
# nowhere to run, and saying so beats a docker error.
function checks_require_container() {
  local where="$1" project_path="$2";
  case "${where}" in
    site)
      if ! ( cd "${project_path}" && ddev describe -j 2>/dev/null | grep -q '"status":"running"' ) ; then
        echo "Starting ${doc_name}/${PROJECT_NAME}…";
        ( cd "${project_path}" && ddev start -y ) || return 1 ;
      fi
      ;;
    dashboard)
      if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^ddev-workspace-web$' ; then
        echo "The workspace dashboard container is not running, and a package has no DDEV project of its own.";
        echo "  Start it:  cd ${WORKSPACE_PATH}/workspace-app && ddev start -y";
        return 1 ;
      fi
      ;;
  esac
  return 0 ;
}

function checks_command() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  local where runner runner_reason deps_installed deps_evidence postinstall_count has_package is_site;
  local started status=0 ran=0 passed=0 failed=0 refused=0 skipped=0 declared=0;
  local failed_ids="";

  if [ ! -d "${project_path}" ] ; then
    echo "No ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}.";
    return 2 ;
  fi

  # The plan, from the one resolver. `--format=meta` answers the questions about the package as a
  # whole; the default TSV answers them per check.
  local plan_args="";
  [ ! "${ONLY}" == '_none_' ] && plan_args="${plan_args} --only=${ONLY}";
  [ ! "${SKIP}" == '_none_' ] && plan_args="${plan_args} --skip=${SKIP}";
  [ ! "${RUNNER}" == '_none_' ] && plan_args="${plan_args} --runner=${RUNNER}";
  [ "${E2E}" == 'yes' ] && plan_args="${plan_args} --e2e";
  plan_args="${plan_args} --browser=${BROWSER}";

  IFS=$'\t' read -r runner runner_reason deps_installed deps_evidence postinstall_count has_package is_site \
    < <(node "${CHECKS_PLAN_JS}" "${project_path}" --format=meta ${plan_args} | head -1);

  where="$(checks_where "${project_path}")";

  echo "";
  echo "── Checks · ${doc_name}/${PROJECT_NAME} ─────────────────────────────";
  if [ "${has_package}" == 'yes' ] ; then
    echo "   ${runner:-(no runner)} (${runner_reason}) · dependencies $([ "${deps_installed}" == 'yes' ] && echo 'installed' || echo 'NOT installed') (${deps_evidence})";
  else
    echo "   no package.json — only the checks a DDEV add-on provides can apply here";
  fi
  echo "   running in: ${where}";
  echo "";

  # --list is pure filesystem work: it starts nothing and needs no dependencies.
  if [ "${LIST}" == 'yes' ] ; then
    node "${CHECKS_PLAN_JS}" "${project_path}" ${plan_args} \
      | awk -F'\t' '{ printf "   %-9s %-14s %-14s %s\n", $1, $3, $4, ($5 != "" ? $5 : $6) }';
    if [ "${postinstall_count}" != '0' ] ; then
      echo "";
      echo "   Installing this package would also run:";
      node "${CHECKS_PLAN_JS}" "${project_path}" --format=meta | tail -n +2 | awk -F'\t' '{ printf "     %s\n", $2 }';
    fi
    echo "";
    return 0 ;
  fi

  # Dependencies are never installed behind your back: a package's own postinstall can write into a
  # docroot or run a webpack build, so --install is the arming step and it says what it will run.
  if [ "${has_package}" == 'yes' ] && [ "${deps_installed}" == 'no' ] ; then
    if [ "${INSTALL}" == 'yes' ] ; then
      checks_require_container "${where}" "${project_path}" || return 2 ;
      echo "Installing with ${runner} (${runner_reason}).";
      if [ "${postinstall_count}" != '0' ] ; then
        echo "This package runs ${postinstall_count} script(s) on install, which write into the tree:";
        node "${CHECKS_PLAN_JS}" "${project_path}" --format=meta | tail -n +2 | awk -F'\t' '{ printf "  %s\n", $2 }';
      fi
      case "${where}" in
        site)      ( cd "${project_path}" && ddev ${runner} install ) || return 2 ;;
        here)      ( cd "${project_path}" && bash -lc "${runner} install" ) || return 2 ;;
        dashboard) ( cd "${WORKSPACE_PATH}/workspace-app" && ddev exec -d "${project_path}" "${runner} install" ) || return 2 ;;
      esac
      plan_args="${plan_args} --assume-installed";
    else
      echo "Nothing ran: the dependencies of ${doc_name}/${PROJECT_NAME} are not installed.";
      echo "  Install them and check:  bash cmd-tools-checks.sh ${PROJECT_NAME} --install";
      echo "  See the plan first:      bash cmd-tools-checks.sh ${PROJECT_NAME} --list";
      return 2 ;
    fi
  fi

  started="$(date +%s)";
  local summary="";

  while IFS=$'\t' read -r id label row_status script command reason ; do
    case "${row_status}" in
      ready)
        declared=$(( declared + 1 ));
        checks_require_container "${where}" "${project_path}" || return 2 ;
        echo "── ${id} ───────────────────────────────────────────────";
        local one_started one_status;
        one_started="$(date +%s)";
        if [[ "${script}" == ddev\ * ]] ; then
          checks_run_addon "${project_path}" "${command}";
        elif [ "${id}" == 'e2e' ] && [ -f "${WORKSPACE_ROOT}/${doc_name}/cmd-tools-testing.sh" ] ; then
          # The browser suite already has a command of its own, with the shared browser cache and the
          # report handling in it. Hand over rather than reimplement half of it here.
          bash "${WORKSPACE_ROOT}/${doc_name}/cmd-tools-testing.sh" "${PROJECT_NAME}" --run --browser "${BROWSER}" < /dev/null ;
        else
          checks_run_one "${where}" "${project_path}" "${runner}" "${script}";
        fi
        one_status=$? ;
        ran=$(( ran + 1 ));
        if [ ${one_status} -eq 0 ] ; then
          passed=$(( passed + 1 ));
          summary="${summary} ✅ $(printf '%-9s' "${id}") $(printf '%4ss' "$(( $(date +%s) - one_started ))")  ${script}\n";
        else
          failed=$(( failed + 1 ));
          failed_ids="${failed_ids} ${id}";
          status=1 ;
          summary="${summary} ❌ $(printf '%-9s' "${id}") $(printf '%4ss' "$(( $(date +%s) - one_started ))")  ${script}\n";
          if [ "${FAIL_FAST}" == 'yes' ] ; then
            echo "";
            echo "Stopping at the first failure, as asked (--fail-fast).";
            break ;
          fi
        fi
        echo "";
        ;;
      masked)
        # A masked script cannot be trusted and cannot be ignored: it FAILS the run. The visible
        # escape is --skip <id>, which is printed in the summary rather than hidden in a config.
        declared=$(( declared + 1 ));
        failed=$(( failed + 1 ));
        failed_ids="${failed_ids} ${id}";
        status=1 ;
        summary="${summary} ⛔ $(printf '%-9s' "${id}")    —  ${script} — ${reason}\n";
        ;;
      refused)
        declared=$(( declared + 1 ));
        refused=$(( refused + 1 ));
        summary="${summary} 🚫 $(printf '%-9s' "${id}")    —  ${script} — ${reason}\n";
        ;;
      skipped|deps-missing|unresolved-runner)
        declared=$(( declared + 1 ));
        skipped=$(( skipped + 1 ));
        summary="${summary} ⏭  $(printf '%-9s' "${id}")    —  ${script:-—} — ${reason}\n";
        ;;
      *)
        summary="${summary} ➖ $(printf '%-9s' "${id}")    —  ${reason}\n";
        ;;
    esac
  done < <(node "${CHECKS_PLAN_JS}" "${project_path}" ${plan_args});

  echo "";
  echo "── Summary · ${doc_name}/${PROJECT_NAME} ────────────────────────────";
  printf "%b" "${summary}";
  echo "";
  echo "   ${ran} ran · ${passed} passed · ${failed} failed · ${refused} refused · ${skipped} skipped   ($(( $(date +%s) - started ))s)";
  if [ -n "${failed_ids}" ] ; then
    echo "   Failed:${failed_ids}";
    echo "   Re-run just those:  bash cmd-tools-checks.sh ${PROJECT_NAME} --only $(echo "${failed_ids}" | tr -s ' ' | sed 's/^ //;s/ /,/g')";
  fi
  if [ ${ran} -eq 0 ] && [ ${failed} -eq 0 ] ; then
    echo "   Nothing ran. ${PROJECT_NAME} declares no check this verb can run — see --list.";
  fi
  echo "";

  # The marker the dashboard reads for its caption. Written outside the package, like a graph, so a
  # shipped repository never carries a file this tooling made.
  if [ ${ran} -gt 0 ] ; then
    mkdir -p "${CHECKS_STATE_DIR}/${doc_name}";
    printf '{"at":%s,"workspace":"%s","project":"%s","ran":%s,"passed":%s,"failed":%s,"refused":%s,"skipped":%s,"seconds":%s}\n' \
      "$(date +%s)" "${doc_name}" "${PROJECT_NAME}" "${ran}" "${passed}" "${failed}" "${refused}" "${skipped}" "$(( $(date +%s) - started ))" \
      > "${CHECKS_STATE_DIR}/${doc_name}/${PROJECT_NAME}.json";
  fi

  return ${status} ;
}
