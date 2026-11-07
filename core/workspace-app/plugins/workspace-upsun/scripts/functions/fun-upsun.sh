#!/usr/bin/env bash

# Upsun (https://upsun.com) is where workspace projects run in the cloud —
# client demos, sandboxes, the public Webship demo. A project links to Upsun
# through `upsun project:set-remote <id>`, which writes .upsun/local/project.yaml
# and adds an `upsun` git remote; deploys are `upsun push`.
#
# These functions are the local ⇄ cloud bridge for one project directory.
# Everything defaults to read-only; the mutating verbs (--link, --init, --push)
# each demand an explicit flag, and nothing here ever creates or deletes an
# Upsun project or environment.

# Make sure the upsun CLI is available. It is installed system-wide or per
# https://docs.upsun.com/administration/cli.html — not something to install
# silently, since it immediately carries the user's cloud credentials.
function ensure_upsun() {
  if command -v upsun > /dev/null 2>&1 ; then
    return 0 ;
  fi
  echo "The upsun CLI is not installed. Install it first:" ;
  echo "  curl -fsSL https://raw.githubusercontent.com/upsun/cli/main/installer.sh | bash" ;
  echo "  (or: brew install upsun/tap/upsun-cli)" ;
  echo "then authenticate with: upsun auth:browser-login" ;
  echo "For CI: set an API token and UPSUN_CLI_NO_INTERACTION=1 instead." ;
  return 1 ;
}

# The Upsun project ID a directory is linked to, if any.
function upsun_linked_id() {
  local link_file="$1/.upsun/local/project.yaml";
  if [ -f "${link_file}" ]; then
    grep '^id:' "${link_file}" | awk '{print $2}' ;
  fi
}

# The environment (branch) a project's local tooling works against.
#
# Kept in .upsun/local/, which the CLI's own README calls its local-only directory and which
# `upsun project:set-remote` already excluded from git via .git/info/exclude — so remembering a
# branch dirties no repository, and a project that is cloned fresh simply has no selection yet.
UPSUN_ENV_FILE=".upsun/local/workspace-environment";

function upsun_selected_env() {
  local file="$1/${UPSUN_ENV_FILE}";
  [ -f "${file}" ] && head -1 "${file}" | tr -d '[:space:]' ;
}

function upsun_select_env() {
  local project_path="$1" env="$2";
  mkdir -p "${project_path}/.upsun/local" ;
  printf '%s\n' "${env}" > "${project_path}/${UPSUN_ENV_FILE}" ;
}

# Which environment a run acts on: --environment for this run, else the remembered selection,
# else nothing (the caller decides whether that is fatal). Deliberately NOT defaulting to
# `main`: pulling production data because nobody said otherwise is exactly the accident worth
# preventing.
function upsun_target_env() {
  local project_path="$1";
  if [ ! "${ENVIRONMENT}" == '_none_' ] ; then printf '%s' "${ENVIRONMENT}"; return 0 ; fi
  upsun_selected_env "${project_path}";
}

# Where this project serves from — Drupal's two conventions, plus the flat case.
function upsun_docroot() {
  local project_path="$1";
  for candidate in web docroot ; do
    [ -d "${project_path}/${candidate}" ] && { printf '%s' "${candidate}"; return 0 ; }
  done
  printf '%s' "";
}

# Pull the database of one environment into the local DDEV project.
#
# Read-only in the cloud and destructive locally, which is the opposite way round from the rest of
# this file: the local database is REPLACED. So the local one is exported first, unconditionally,
# and the run says where that copy went before it starts.
function upsun_pull_db() {
  local project_path="$1" linked_id="$2" env="$3";
  local stamp out dump safety;

  stamp="$(date +%Y-%m-%d-%H%M%S)";
  out="${backups}/${doc_name}/${PROJECT_NAME}";
  mkdir -p "${out}" ;
  dump="${out}/${PROJECT_NAME}-upsun-${env}-${stamp}.sql.gz";
  safety="${out}/${PROJECT_NAME}-before-upsun-pull-${stamp}.sql.gz";

  echo "";
  echo "Pulling the ${env} database of Upsun project ${linked_id}.";
  echo "  This is client data: it lands on this machine and in ${out}.";
  echo "  Sanitize it before sharing — see the drupal-thin-db-export skill.";
  echo "";

  # The local database is replaced, so it is exported first. A pull that ate an afternoon's work
  # because nobody thought to dump it is a bad pull.
  if [ "${NO_SAFETY_BACKUP:-no}" == 'yes' ] ; then
    echo "Skipping the local database export, as asked. The current local data will be lost.";
  else
    echo "Exporting the current local database first.";
    (cd "${project_path}" && ddev export-db --file="${safety}") \
      || echo "  (no local database to export yet — continuing)";
  fi

  echo "Dumping ${env} from Upsun.";
  local upsun_app ;
  upsun_app=$(cd "${project_path}" && upsun apps -p "${linked_id}" -e "${env}" --pipe 2>/dev/null | grep -v '^storybook$' | head -1) ;
  upsun_app="${upsun_app:-drupal}" ;
  (cd "${project_path}" && upsun db:dump -p "${linked_id}" -e "${env}" --app "${upsun_app}" --gzip -f "${dump}") || return 1 ;

  echo "Importing it into DDEV.";
  (cd "${project_path}" && ddev start -y > /dev/null && ddev import-db --file="${dump}") || return 1 ;

  echo "";
  echo "  Imported ${env} into ${doc_name}/${PROJECT_NAME}.";
  echo "    pulled dump:   ${dump}";
  echo "    local backup:  ${safety}";
  echo "  Drupal sites usually need: ddev drush updb -y && ddev drush cr";
}

# Pull the files mount of one environment into the local site.
#
# Only the public files mount, and only into this project's own docroot: the private mount and the
# rest of the tree are not what "the images are missing locally" means, and downloading a client's
# private files onto a laptop is not something to do as a side effect.
function upsun_pull_files() {
  local project_path="$1" linked_id="$2" env="$3";
  local docroot mount target;

  docroot="$(upsun_docroot "${project_path}")";
  if [ -z "${docroot}" ] ; then
    echo "No web/ or docroot/ in ${doc_name}/${PROJECT_NAME} — nothing to pull files into.";
    return 1 ;
  fi
  mount="${docroot}/sites/default/files";
  target="${project_path}/${mount}";

  echo "";
  echo "Pulling the ${env} files mount of Upsun project ${linked_id} into ${mount}.";
  echo "  This is client data. rsync-style: it adds and overwrites, and does not delete.";
  echo "";
  mkdir -p "${target}" ;
  local upsun_app ;
  upsun_app=$(cd "${project_path}" && upsun apps -p "${linked_id}" -e "${env}" --pipe 2>/dev/null | grep -v '^storybook$' | head -1) ;
  upsun_app="${upsun_app:-drupal}" ;
  (cd "${project_path}" && upsun mount:download -p "${linked_id}" -e "${env}" --app "${upsun_app}" \
     --mount "${mount}" --target "${target}" -y) || return 1 ;

  echo "";
  echo "  Files are in ${mount}.";
  echo "  If Drupal still shows broken images: ddev drush cr";
}

function upsun_project_tool() {
  ensure_upsun || return 1 ;

  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  local linked_id="";

  if [ ! -d "${project_path}" ]; then
    echo "No such project: ${project_path}";
    return 1 ;
  fi

  cd "${project_path}" ;
  linked_id=$(upsun_linked_id "${project_path}") ;

  # --link <id>: formalize the hand-ritual. Refuses to silently relink a
  # project that already points somewhere (the webship-com-site/website_starter
  # duplicate-ID mixup is exactly what this guards against).
  if [ ! "${LINK}" == '_none_' ] ; then
    if [ -n "${linked_id}" ] && [ ! "${linked_id}" == "${LINK}" ] && [ ! "${FORCE}" == 'yes' ] ; then
      echo "${doc_name}/${PROJECT_NAME} is already linked to Upsun project ${linked_id}." ;
      echo "Re-run with --force to relink it to ${LINK}." ;
      return 1 ;
    fi
    upsun project:set-remote "${LINK}" || return 1 ;
    echo "Linked ${doc_name}/${PROJECT_NAME} → ${LINK}." ;
    linked_id="${LINK}";
  fi

  # --init: scaffold .upsun/config.yaml for a project that has none. Upsun's
  # own generator asks the stack questions interactively. For a Drupal project
  # the official path is better than the generic generator, so point at it.
  if [ "${INIT}" == 'yes' ] ; then
    if [ -f ".upsun/config.yaml" ]; then
      echo ".upsun/config.yaml already exists — edit it instead of re-initializing." ;
    else
      if grep -q '"drupal/core' composer.json 2>/dev/null ; then
        echo "This is a Drupal project. The official Upsun paths for Drupal:" ;
        echo "  - upsun/drupal-scaffold — a composer plugin that places .upsun/config.yaml and" ;
        echo "    settings.upsun.php into an existing recommended-project structure:" ;
        echo "      composer config repositories.upsun-drupal-scaffold vcs https://github.com/upsun/drupal-scaffold" ;
        echo "      composer config --json --merge extra.drupal-scaffold.allowed-packages '[\"upsun/drupal-scaffold\"]'" ;
        echo "      ddev composer require upsun/drupal-scaffold" ;
        echo "  - the Drupal reference config in the upsun skill (references/config/drupal.md," ;
        echo "    from github.com/upsun/ai): build/deploy hooks with drush, mounts, redis, crons." ;
        echo "  Verify image versions against https://meta.upsun.com/images before committing." ;
        echo "" ;
        echo "Running the generic generator anyway:" ;
      fi
      upsun project:init || return 1 ;
    fi
  fi

  # --push: deploy the current branch. Outward-facing, so say exactly what is
  # about to happen and let upsun's own confirmation gate it.
  if [ "${PUSH}" == 'yes' ] ; then
    if [ -z "${linked_id}" ]; then
      echo "Not linked to an Upsun project — run with --link <id> first." ;
      return 1 ;
    fi
    echo "Pushing branch '$(git rev-parse --abbrev-ref HEAD 2>/dev/null)' of ${doc_name}/${PROJECT_NAME} to Upsun project ${linked_id}…" ;
    if [ ! "${ENVIRONMENT}" == '_none_' ] ; then
      upsun push --target "${ENVIRONMENT}" || return 1 ;
    else
      upsun push || return 1 ;
    fi
  fi

  # --environments: the branch list, which is what you pick from.
  if [ "${ENVIRONMENTS}" == 'yes' ] ; then
    if [ -z "${linked_id}" ] ; then
      echo "Not linked to an Upsun project — run with --link <id> first." ;
      return 1 ;
    fi
    upsun environment:list -p "${linked_id}" || return 1 ;
    echo "";
    echo "  Select one:  bash cmd-tools-upsun.sh ${PROJECT_NAME} --select <environment>";
  fi

  # --select: remember which environment this project works against, so the pulls take no flag.
  if [ ! "${SELECT}" == '_none_' ] ; then
    if [ -z "${linked_id}" ] ; then
      echo "Not linked to an Upsun project — run with --link <id> first." ;
      return 1 ;
    fi
    # Checked against the real list rather than taken on trust: a typo would otherwise be
    # discovered by a pull that dumps the wrong branch, or none.
    if ! upsun environment:list -p "${linked_id}" --pipe 2>/dev/null | grep -qx "${SELECT}" ; then
      echo "Upsun project ${linked_id} has no environment called '${SELECT}'." ;
      echo "  List them: bash cmd-tools-upsun.sh ${PROJECT_NAME} --environments" ;
      return 1 ;
    fi
    upsun_select_env "${project_path}" "${SELECT}" ;
    echo "${doc_name}/${PROJECT_NAME} now works against the ${SELECT} environment." ;
  fi

  # --pull-db / --pull-files: bring the cloud's data down. Read-only in the cloud, destructive
  # locally, and client data either way — so each needs its own flag and an environment that was
  # named or selected. There is no default environment on purpose.
  if [ "${PULL_DB}" == 'yes' ] || [ "${PULL_FILES}" == 'yes' ] ; then
    local target_env;
    target_env="$(upsun_target_env "${project_path}")";
    if [ -z "${linked_id}" ] ; then
      echo "Not linked to an Upsun project — run with --link <id> first." ;
      return 1 ;
    fi
    if [ -z "${target_env}" ] ; then
      echo "No environment selected. Pick one first — a pull must never guess which branch it takes data from:" ;
      echo "  bash cmd-tools-upsun.sh ${PROJECT_NAME} --environments" ;
      echo "  bash cmd-tools-upsun.sh ${PROJECT_NAME} --select <environment>" ;
      echo "  (or name it for this run: --environment <environment>)" ;
      return 1 ;
    fi
    [ "${PULL_DB}" == 'yes' ] && { upsun_pull_db "${project_path}" "${linked_id}" "${target_env}" || return 1 ; }
    [ "${PULL_FILES}" == 'yes' ] && { upsun_pull_files "${project_path}" "${linked_id}" "${target_env}" || return 1 ; }
  fi

  # --logs / --activities: recent deploy output and activity trail.
  if [ "${LOGS}" == 'yes' ] ; then
    upsun activity:log --type environment.push 2>/dev/null || upsun activity:log || true ;
  fi
  if [ "${ACTIVITIES}" == 'yes' ] ; then
    upsun activity:list --limit 10 || true ;
  fi

  # Default (and after any verb): status.
  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  ${doc_name}/${PROJECT_NAME} on Upsun";
  if [ -z "${linked_id}" ]; then
    echo "    not linked. Link it with:";
    echo "      bash cmd-tools-upsun.sh ${PROJECT_NAME} --link <upsun-project-id>";
    echo "    (find the ID with: upsun projects)";
  else
    echo "    project: ${linked_id}";
    if [ -f ".upsun/config.yaml" ]; then
      echo "    config:  .upsun/config.yaml present";
    else
      echo "    config:  MISSING — scaffold it with --init before a first push";
    fi
    local selected;
    selected="$(upsun_selected_env "${project_path}")";
    echo "    branch:  ${selected:-none selected — --environments then --select <name>}";
    echo "";
    upsun environment:list 2>/dev/null || echo "    (could not list environments — check upsun auth:info)";
    echo "";
    echo "  URLs: upsun url --primary   |   deploy: bash cmd-tools-upsun.sh ${PROJECT_NAME} --push";
    echo "  Data: --pull-db and --pull-files bring ${selected:-the selected environment} down into DDEV.";
  fi
  echo "*---------------------------------------------------------------------*";

  cd "${WORKSPACE_ROOT}/${doc_name}";
}
