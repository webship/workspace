#!/usr/bin/env bash

# The commands workspace: one place to see and manage every cmd-*.sh in the tree.
#
# The scripts themselves live in the workspace folder they belong to — a builder
# for dev sits in dev/ because that is where it is run from, and moving them here
# would break every path in the harness. So this workspace holds no scripts of
# its own; it is a view over the others, plus the operations that are awkward
# when the commands are scattered across nineteen folders:
#
#   list      what exists, everywhere, with what each one builds
#   new       scaffold a command into a workspace, bootstrap chain already right
#   clone     copy one, retargeted at another workspace if asked
#   pull      bring a command (or a new one) down from the tooling repository
#   diff      what this machine has against what the repo has
#   propose   hand a local command to the AI agent to file the issue and open
#             the PR — never silently: it prints the plan and waits for --confirm
#
# Nothing here writes to the repository directly. Publishing goes through the
# agent, which follows the workspace's issue/PR rules (issue first,
# Checkpoints, never tick the human-review boxes).

# WORKSPACE_REPO / WORKSPACE_REPO_REF are resolved in bootstrap.sh from settings.yml
# `sources.tooling`, because this file is sourced before settings.yml is parsed.

# Let git borrow the gh CLI's login for github.com, so cloning the tooling repository works
# without a token in the environment and without one written into a remote URL.
#
# Defined here rather than imported: it is four lines, and this is the only thing in this
# workspace that clones from GitHub over https.
function ensure_git_github_auth() {
  command -v gh > /dev/null 2>&1 || return 0 ;
  export GIT_CONFIG_COUNT=1 ;
  export GIT_CONFIG_KEY_0="credential.https://github.com.helper" ;
  export GIT_CONFIG_VALUE_0="!gh auth git-credential" ;
}

# Where the local mirror of the tooling repository is kept. Gitignored, and
# hidden from the command listing.
function commands_repo_checkout() {
  echo "${WORKSPACE_ROOT}/${doc_name}/workspace-repo";
}

# Every workspace folder, in the order settings.yml lists them.
#
# bootstrap.sh has already evaluated settings.yml, so `workspaces` is a bash
# array here. Do NOT re-evaluate it: parse_yaml emits `workspaces+=("…")`, so a
# second eval appends the whole list again and every workspace is visited twice.
# Deduplicated anyway, cheaply, so a caller that did re-evaluate cannot produce
# doubled output.
function commands_workspaces() {
  local seen=" " name;
  for name in "${workspaces[@]}" ; do
    [ -z "${name}" ] && continue ;
    case "${seen}" in *" ${name} "*) continue ;; esac
    seen="${seen}${name} " ;
    echo "${name}" ;
  done
}

# The human name a builder declares for itself, used by the dashboard's Build
# dropdown and enforced by the smoke test.
function command_workspace_name() {
  local file="$1";
  sed -n 's/^# workspace-name:[[:space:]]*//p' "${file}" 2>/dev/null | head -1 ;
}

# List every cmd-*.sh, or those of one workspace.
function commands_list() {
  local only="${1:-}";
  local total=0 ws dir count label;

  echo "*---------------------------------------------------------------------*";
  echo "  cmd-*.sh across the workspace";
  echo "*---------------------------------------------------------------------*";

  for ws in $(commands_workspaces) ; do
    if [ -n "${only}" ] && [ ! "${only}" == '_all_' ] && [ ! "${ws}" == "${only}" ] ; then continue ; fi
    dir="${WORKSPACE_ROOT}/${ws}";
    [ -d "${dir}" ] || continue ;
    count=$(find "${dir}" -maxdepth 1 -name 'cmd-*.sh' 2>/dev/null | wc -l) ;
    [ "${count}" -eq 0 ] && continue ;
    printf "\n  %s (%s)\n" "${ws}" "${count}" ;
    local f;
    for f in $(find "${dir}" -maxdepth 1 -name 'cmd-*.sh' -printf '%f\n' 2>/dev/null | sort) ; do
      label=$(command_workspace_name "${dir}/${f}") ;
      if [ -n "${label}" ]; then
        printf "    %-52s %s\n" "${f}" "${label}" ;
      else
        printf "    %s\n" "${f}" ;
      fi
      total=$((total+1)) ;
    done
  done
  printf "\n  %s command(s).\n" "${total}" ;
}

# Find which workspace folder holds a command, by file name.
function commands_locate() {
  local file="$1" ws;
  for ws in $(commands_workspaces) ; do
    if [ -f "${WORKSPACE_ROOT}/${ws}/${file}" ]; then echo "${ws}"; return 0 ; fi
  done
  return 1 ;
}

# Refresh the local mirror of the tooling repository.
#
# Reads files out of the FETCHED REMOTE BRANCH with git archive, never the
# checkout's working tree, so a mirror someone has been poking at is left alone.
function commands_repo_sync() {
  local checkout;
  checkout=$(commands_repo_checkout) ;

  # A real authenticated call, not `gh auth status`: that exits non-zero when ANY configured
  # account fails, and the dashboard container carries a stale one beside a working GH_TOKEN.
  # `--active` would fix that but does not exist in the gh Ubuntu ships (2.45).
  if command -v gh > /dev/null 2>&1 && gh api user --jq .login > /dev/null 2>&1 ; then
    ensure_git_github_auth ;
  fi

  if [ -d "${checkout}/.git" ]; then
    echo "Fetching ${WORKSPACE_REPO}…" ;
    git -C "${checkout}" fetch --quiet origin || return 1 ;
  else
    echo "Cloning ${WORKSPACE_REPO}…" ;
    git clone --quiet "https://github.com/${WORKSPACE_REPO}.git" "${checkout}" || {
      echo "Could not clone ${WORKSPACE_REPO}." ;
      echo "  If it is private, this needs a GitHub login:" ;
      echo "    on this machine:            gh auth login" ;
      echo "    in the dashboard container: set GH_TOKEN in its DDEV web_environment" ;
      return 1 ;
    }
  fi
}

# Echo a temp directory holding the repository's cmd-*.sh tree at the target ref.
function commands_repo_tree() {
  local checkout tmp;
  checkout=$(commands_repo_checkout) ;
  tmp=$(mktemp -d) ;
  if ! git -C "${checkout}" archive "origin/${WORKSPACE_REPO_REF}" 2>/dev/null | tar -x -C "${tmp}" ; then
    echo "Nothing at origin/${WORKSPACE_REPO_REF} in the mirror." >&2 ;
    rm -rf "${tmp}" ; return 1 ;
  fi
  echo "${tmp}" ;
}

# What the repository has, and whether this machine has it too.
function commands_list_remote() {
  commands_repo_sync || return 1 ;
  local tmp;
  tmp=$(commands_repo_tree) || return 1 ;

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}";
  echo "*---------------------------------------------------------------------*";
  local ws f local_file state missing=0 differs=0 same=0;
  for ws in $(commands_workspaces) ; do
    [ -d "${tmp}/${ws}" ] || continue ;
    for f in $(find "${tmp}/${ws}" -maxdepth 1 -name 'cmd-*.sh' -printf '%f\n' 2>/dev/null | sort) ; do
      local_file="${WORKSPACE_ROOT}/${ws}/${f}";
      if [ ! -f "${local_file}" ]; then
        state="not here";  missing=$((missing+1)) ;
      elif cmp -s "${local_file}" "${tmp}/${ws}/${f}" ; then
        state="same";      same=$((same+1)) ;
      else
        state="differs";   differs=$((differs+1)) ;
      fi
      printf "  %-11s %-14s %s\n" "${ws}" "${state}" "${f}" ;
    done
  done
  rm -rf "${tmp}" ;
  printf "\n  %s same · %s differ · %s not on this machine\n" "${same}" "${differs}" "${missing}" ;
  echo "  Bring one down:  bash cmd-tools-commands.sh --pull <cmd-file.sh>" ;
}

# Diff one command against the repository's copy.
function commands_diff() {
  local file="$1";
  commands_repo_sync || return 1 ;
  local tmp found=0;
  tmp=$(commands_repo_tree) || return 1 ;

  local ws;
  for ws in $(commands_workspaces) ; do
    [ -f "${tmp}/${ws}/${file}" ] || continue ;
    found=1 ;
    if [ ! -f "${WORKSPACE_ROOT}/${ws}/${file}" ]; then
      echo "${ws}/${file}: only in ${WORKSPACE_REPO} — --pull to bring it down." ;
    elif cmp -s "${WORKSPACE_ROOT}/${ws}/${file}" "${tmp}/${ws}/${file}" ; then
      echo "${ws}/${file}: identical to ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}." ;
    else
      echo "${ws}/${file}: differs (< repo, > this machine)" ;
      diff "${tmp}/${ws}/${file}" "${WORKSPACE_ROOT}/${ws}/${file}" ;
    fi
  done
  rm -rf "${tmp}" ;
  [ "${found}" -eq 1 ] || { echo "No '${file}' in ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}." ; return 1 ; }
}

# Bring a command down from the repository into the workspace folder it belongs
# to — including one this machine does not have yet.
function commands_pull() {
  local file="$1";
  commands_repo_sync || return 1 ;
  local tmp pulled=0;
  tmp=$(commands_repo_tree) || return 1 ;

  local ws dest keep;
  for ws in $(commands_workspaces) ; do
    [ -f "${tmp}/${ws}/${file}" ] || continue ;
    dest="${WORKSPACE_ROOT}/${ws}";
    mkdir -p "${dest}" ;

    # A pull overwrites, and the ref can easily be BEHIND this machine — the
    # default branch does not carry work that is still in review, so pulling can
    # silently undo a local fix. Keep the version being replaced, under
    # backups/, and say where it went.
    if [ -f "${dest}/${file}" ] && ! cmp -s "${dest}/${file}" "${tmp}/${ws}/${file}" ; then
      keep="${backups}/${doc_name}/${ws}---${file}--$(date '+%Y-%m-%d_%H-%M-%S').bak";
      mkdir -p "${backups}/${doc_name}" ;
      cp -a "${dest}/${file}" "${keep}" ;
      echo "  the copy here differed — kept it at ${keep}" ;
    fi

    cp "${tmp}/${ws}/${file}" "${dest}/${file}" ;
    chmod +x "${dest}/${file}" ;
    echo "Pulled ${ws}/${file} from ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}." ;
    pulled=$((pulled+1)) ;
  done
  rm -rf "${tmp}" ;
  [ "${pulled}" -gt 0 ] || { echo "No '${file}' in ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}." ; return 1 ; }
}

# Bring the repository's commands down in bulk.
#
# Two categories, treated differently on purpose:
#
#   missing   this machine does not have it. Safe to take: nothing is lost.
#   differs   both have it and they are not the same. NOT safe to take blindly — the difference
#             may be a local fix that has not been proposed yet, which is exactly what the first
#             comparison of this workspace found.
#
# So a plain --sync reports and changes nothing, --confirm takes the missing ones, and only
# --overwrite replaces the ones that differ. Each replaced file is kept under backups/ first,
# the same as a single --pull.
function commands_sync() {
  local confirmed="$1" overwrite="$2";
  commands_repo_sync || return 1 ;
  local tmp;
  tmp=$(commands_repo_tree) || return 1 ;

  local ws file dest missing=() differs=() same=0;
  for ws in $(commands_workspaces) ; do
    [ -d "${tmp}/${ws}" ] || continue ;
    for file in $(cd "${tmp}/${ws}" && ls cmd-*.sh 2>/dev/null) ; do
      dest="${WORKSPACE_ROOT}/${ws}/${file}";
      if [ ! -f "${dest}" ] ; then
        missing+=("${ws}/${file}") ;
      elif cmp -s "${dest}" "${tmp}/${ws}/${file}" ; then
        same=$((same+1)) ;
      else
        differs+=("${ws}/${file}") ;
      fi
    done
  done

  echo "*---------------------------------------------------------------------*";
  echo "  Sync from ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}";
  echo "*---------------------------------------------------------------------*";
  echo "  ${same} identical · ${#missing[@]} missing here · ${#differs[@]} differ";
  echo "";
  local entry;
  for entry in "${missing[@]}" ; do echo "  missing    ${entry}" ; done
  for entry in "${differs[@]}" ; do echo "  differs    ${entry}" ; done

  if [ "${#missing[@]}" -eq 0 ] && [ "${#differs[@]}" -eq 0 ] ; then
    echo "" ; echo "  Nothing to bring down — this machine matches the repository." ;
    rm -rf "${tmp}" ; return 0 ;
  fi

  if [ ! "${confirmed}" == 'yes' ] ; then
    echo "";
    echo "  Nothing has been written. To take the missing ones:";
    echo "    bash cmd-tools-commands.sh --sync --confirm";
    if [ "${#differs[@]}" -gt 0 ] ; then
      echo "  To replace the ones that differ as well (each is kept under backups/ first):";
      echo "    bash cmd-tools-commands.sh --sync --confirm --overwrite";
      echo "  Look at one first:  bash cmd-tools-commands.sh --diff <cmd-file.sh>";
    fi
    rm -rf "${tmp}" ; return 0 ;
  fi

  local took=0 replaced=0 keep;
  for entry in "${missing[@]}" ; do
    ws="${entry%%/*}" ; file="${entry##*/}" ;
    mkdir -p "${WORKSPACE_ROOT}/${ws}" ;
    cp "${tmp}/${ws}/${file}" "${WORKSPACE_ROOT}/${ws}/${file}" ;
    chmod +x "${WORKSPACE_ROOT}/${ws}/${file}" ;
    echo "  took       ${entry}" ;
    took=$((took+1)) ;
  done

  if [ "${overwrite}" == 'yes' ] ; then
    for entry in "${differs[@]}" ; do
      ws="${entry%%/*}" ; file="${entry##*/}" ;
      keep="${backups}/${doc_name}/${ws}---${file}--$(date '+%Y-%m-%d_%H-%M-%S').bak";
      mkdir -p "${backups}/${doc_name}" ;
      cp -a "${WORKSPACE_ROOT}/${ws}/${file}" "${keep}" ;
      cp "${tmp}/${ws}/${file}" "${WORKSPACE_ROOT}/${ws}/${file}" ;
      chmod +x "${WORKSPACE_ROOT}/${ws}/${file}" ;
      echo "  replaced   ${entry}  (yours kept at ${keep})" ;
      replaced=$((replaced+1)) ;
    done
  fi

  rm -rf "${tmp}" ;
  echo "";
  echo "  ${took} taken · ${replaced} replaced";
  if [ "${overwrite}" != 'yes' ] && [ "${#differs[@]}" -gt 0 ] ; then
    echo "  ${#differs[@]} left alone because they differ — add --overwrite to replace them too.";
  fi
}

# Retarget a command at a workspace: the settings file it reads and the folder
# name in its comments. A builder copied from dev to demos that still reads
# workspace.dev.settings.yml would build into the wrong folder, which is the one
# mistake a clone must not make.
function command_retarget_workspace() {
  local file="$1" from="$2" to="$3";
  [ "${from}" == "${to}" ] && return 0 ;
  python3 - "${file}" "${from}" "${to}" <<'PYEOF'
import re, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(path).read()
s = s.replace(f'workspace.{old}.settings.yml', f'workspace.{new}.settings.yml')
# Folder mentions in comments and echoed paths, bounded so a longer name that
# merely starts with the old one is left alone.
s = re.sub(r'(?<![\w-])%s/' % re.escape(old), f'{new}/', s)
open(path, 'w').write(s)
PYEOF
}

# Copy a command under a new name, optionally into another workspace.
function commands_clone() {
  local file="$1" new_name="$2" target="$3";

  if [ -z "${file}" ] || [ "${file}" == '_none_' ] ; then
    echo "Name the command to clone: --clone <cmd-file.sh> --to <new-cmd-file.sh>" ; return 1 ;
  fi
  if [ -z "${new_name}" ] || [ "${new_name}" == '_none_' ] ; then
    echo "Give the copy a name: --to <new-cmd-file.sh>" ; return 1 ;
  fi
  if ! echo "${new_name}" | grep -qE '^cmd-[a-zA-Z0-9_.-]+\.sh$' ; then
    echo "Invalid name '${new_name}': a command is cmd-<something>.sh." ; return 1 ;
  fi

  local source_ws;
  source_ws=$(commands_locate "${file}") || { echo "No '${file}' in any workspace." ; return 1 ; }

  # --workspace defaults to _all_ (it doubles as the --list filter), which for a
  # clone means "leave it where it is", not a workspace called _all_.
  local dest_ws="${source_ws}";
  if [ -n "${target}" ] && [ ! "${target}" == '_none_' ] && [ ! "${target}" == '_all_' ] ; then
    dest_ws="${target}" ;
    [ -d "${WORKSPACE_ROOT}/${dest_ws}" ] || { echo "No such workspace: ${dest_ws}." ; return 1 ; }
    [ -f "${WORKSPACE_CONFIG}/workspace.${dest_ws}.settings.yml" ] || {
      echo "No workspace.${dest_ws}.settings.yml — ${dest_ws} is not a registered workspace." ; return 1 ; }
  fi

  local dest="${WORKSPACE_ROOT}/${dest_ws}/${new_name}";
  [ -e "${dest}" ] && { echo "${dest_ws}/${new_name} already exists — pick another name." ; return 1 ; }

  cp -a "${WORKSPACE_ROOT}/${source_ws}/${file}" "${dest}" ;
  chmod +x "${dest}" ;
  command_retarget_workspace "${dest}" "${source_ws}" "${dest_ws}" ;
  echo "Cloned ${source_ws}/${file} to ${dest_ws}/${new_name}." ;
  if [ ! "${source_ws}" == "${dest_ws}" ] ; then
    echo "  retargeted at workspace.${dest_ws}.settings.yml, and ${source_ws}/ paths repointed" ;
    echo "  Prose and echoed text naming '${source_ws}' are left alone — rewriting a bare" ;
    echo "  workspace name would corrupt ordinary words. Read the file before running it." ;
  fi
  echo "  Set its '# workspace-name:' header to what it builds — the smoke test checks it." ;
  CLONED_COMMAND="${dest}";
}

# Scaffold a new command with the bootstrap chain already correct.
function commands_new() {
  local new_name="$1" target="$2" label="$3";

  if ! echo "${new_name}" | grep -qE '^cmd-[a-zA-Z0-9_.-]+\.sh$' ; then
    echo "Invalid name '${new_name}': a command is cmd-<something>.sh." ; return 1 ;
  fi
  if [ -z "${target}" ] || [ "${target}" == '_none_' ] ; then
    echo "Say which workspace it belongs to: --workspace <name>" ; return 1 ;
  fi
  [ -f "${WORKSPACE_CONFIG}/workspace.${target}.settings.yml" ] || {
    echo "No workspace.${target}.settings.yml — ${target} is not a registered workspace." ; return 1 ; }

  local dest="${WORKSPACE_ROOT}/${target}/${new_name}";
  [ -e "${dest}" ] && { echo "${target}/${new_name} already exists." ; return 1 ; }
  mkdir -p "${WORKSPACE_ROOT}/${target}" ;

  [ -z "${label}" ] || [ "${label}" == '_none_' ] && label="${new_name}";

  cat > "${dest}" <<EOF
#!/usr/bin/env bash

# workspace-name: ${label}

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="\${WORKSPACE_SCRIPTS:-\$(cd "\$(dirname "\${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source \${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval \$(parse_yaml \${WORKSPACE_CONFIG}/workspace.${target}.settings.yml);

ARGPARSE_DESCRIPTION="${label}"
argparse "\$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project.')
ARGEOF

shift \$#;

# What this command does goes here. DDEV only — ddev composer, ddev drush,
# ddev export-db — never raw composer/drush/mysql on the host.
echo "\${PROJECT_NAME} in ${target}: nothing implemented yet." ;
EOF
  chmod +x "${dest}" ;
  echo "Created ${target}/${new_name}." ;
  echo "  header: # workspace-name: ${label}" ;
  echo "  Edit it, then check it: bash core/scripts/tests/cmd-smoke-test.sh" ;
  CREATED_COMMAND="${dest}";
}

# Hand a local command to the AI agent to file the issue and open the PR.
#
# Confirm-gated on purpose. Filing an issue and opening a pull request are
# public, and the house rule is that neither happens without being asked for
# explicitly — so this prints exactly what it would do and stops, and only
# --confirm lets it call the agent.
function commands_propose() {
  local file="$1" summary="$2" confirmed="$3";

  local ws;
  ws=$(commands_locate "${file}") || { echo "No '${file}' in any workspace." ; return 1 ; }
  local path="${WORKSPACE_ROOT}/${ws}/${file}";

  # State whether this is new to the repository or a change to what is there —
  # and say so honestly when the repository cannot be reached. Defaulting to
  # "a change to" would assert something unverified, and in the dashboard
  # container (no GH_TOKEN) that is the usual case.
  local state="a change of unknown status against";
  if commands_repo_sync > /dev/null 2>&1 ; then
    local tmp;
    if tmp=$(commands_repo_tree) ; then
      if [ ! -f "${tmp}/${ws}/${file}" ]; then
        state="new to";
      elif cmp -s "${path}" "${tmp}/${ws}/${file}" ; then
        echo "${ws}/${file} is identical to ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF} — nothing to propose." ;
        rm -rf "${tmp}" ; return 0 ;
      else
        state="a change to";
      fi
      rm -rf "${tmp}" ;
    fi
  fi
  if [ "${state}" == 'a change of unknown status against' ] ; then
    echo "  (could not read ${WORKSPACE_REPO} to compare — the agent will work it out)" ;
  fi

  echo "*---------------------------------------------------------------------*";
  echo "  Propose ${ws}/${file} to ${WORKSPACE_REPO}";
  echo "*---------------------------------------------------------------------*";
  echo "  file      ${path}";
  echo "  status    ${state} ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}";
  echo "  summary   ${summary}";
  echo "";
  echo "  The AI agent would: file an issue, push a branch to a fork, open a PR";
  echo "  against ${WORKSPACE_REPO_REF}, and leave the human-review boxes unticked.";
  echo "  It never merges, and it never pushes to ${WORKSPACE_REPO_REF} directly.";

  if [ ! "${confirmed}" == 'yes' ] ; then
    echo "";
    echo "  Nothing has been created. To go ahead, add --confirm:";
    echo "    bash cmd-tools-commands.sh --propose ${file} --summary \"…\" --confirm";
    return 0 ;
  fi

  if ! command -v claude > /dev/null 2>&1 ; then
    echo "" ;
    echo "  Claude Code CLI not found — cannot hand this over." ;
    echo "  install: https://claude.com/claude-code" ;
    return 1 ;
  fi

  echo "";
  echo "  Handing it to the AI agent…";
  local prompt;
  prompt="Publish one workspace command to the ${WORKSPACE_REPO} repository, following the workspace's issue/PR rules.

File: ${path}
Belongs in: the ${ws}/ folder of the repository
Status: it is ${state} ${WORKSPACE_REPO}@${WORKSPACE_REPO_REF}
What it is for: ${summary}

Do this:
1. Read the file, and read the repository's CLAUDE.md so the command matches how this tooling is written.
2. File one issue on ${WORKSPACE_REPO} describing the command and why it is needed.
3. Push a branch and open ONE pull request against ${WORKSPACE_REPO_REF} containing only this file, referencing the issue, ending with the Checkpoints checklist.
4. Leave 'Reviewed by a human' and 'Code review by maintainers' unticked. Never merge. Never push to ${WORKSPACE_REPO_REF} directly.
5. Report the issue URL and the pull request URL.

Only this one file. Do not include unrelated local changes.";

  claude -p "${prompt}" --allowedTools Read Glob Grep Bash --disallowedTools Write Edit --no-session-persistence ;
}
