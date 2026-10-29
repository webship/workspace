#!/usr/bin/env bash

# gitlab-ci-local (https://github.com/firecow/gitlab-ci-local) runs a project's
# GitLab CI pipeline in local Docker containers. It is how the Webship
# green-gate is enforced: before committing to an issue-fork branch or pushing
# anything to git.drupalcode.org, the full pipeline runs locally and the push
# waits until every stage and every job is green.
#
# Drupal projects include drupal/gitlab_templates, whose jobs die on an unset
# _GITLAB_TEMPLATES_REPO unless the template variables are resolved. The
# standard fix is a wrapper that adds --remote-variables over SSH (upstream
# says HTTPS clones "do not work completely without issues"), which these
# functions install once as ~/.local/bin/drupal-ci-local.

# Make sure gitlab-ci-local is on PATH; offer the install paths if not.
function ensure_gitlab_ci_local() {
  if command -v gitlab-ci-local > /dev/null 2>&1 ; then
    return 0 ;
  fi
  echo "gitlab-ci-local is not installed — installing with npm.";
  npm install -g gitlab-ci-local || {
    echo "npm install failed. Alternatives:" ;
    echo "  brew install gitlab-ci-local          # macOS" ;
    echo "  see https://github.com/firecow/gitlab-ci-local#installation" ;
    return 1 ;
  }
  command -v gitlab-ci-local > /dev/null 2>&1 || {
    echo "Still not on PATH — check npm's global bin directory." ;
    return 1 ;
  }
}

# The Drupal wrapper: gitlab-ci-local plus the drupal/gitlab_templates remote
# variables. Written once, then everything Drupal runs through it.
function ensure_drupal_ci_wrapper() {
  local wrapper="${HOME}/.local/bin/drupal-ci-local";
  if [ -x "${wrapper}" ]; then
    return 0 ;
  fi
  mkdir -p "${HOME}/.local/bin" ;
  cat > "${wrapper}" <<'WRAP'
#!/bin/bash
# gitlab-ci-local wired for drupal/gitlab_templates. SSH on purpose: upstream
# documents that HTTPS template clones do not work completely without issues.
gitlab-ci-local \
  --remote-variables git@git.drupal.org:project/gitlab_templates=includes/include.drupalci.variables.yml=main \
  --variable="_GITLAB_TEMPLATES_REPO=project/gitlab_templates" \
  "$@"
WRAP
  chmod +x "${wrapper}" ;
  echo "Installed ${wrapper}." ;
}

# Everything a run needs, checked up front with real error messages.
function gitlab_ci_local_doctor() {
  local ok=0;
  ensure_gitlab_ci_local || ok=1 ;
  ensure_drupal_ci_wrapper || ok=1 ;
  if ! docker info > /dev/null 2>&1 ; then
    echo "Docker is not reachable — every job runs in a container. Start Docker first." ;
    ok=1 ;
  fi
  if ! ssh -o BatchMode=yes -o ConnectTimeout=8 git@git.drupal.org 2>&1 | grep -q 'Welcome to GitLab' ; then
    echo "SSH to git.drupal.org failed — the Drupal template variables are fetched over SSH." ;
    echo "Load your key into ssh-agent, or add one: https://git.drupalcode.org/-/user_settings/ssh_keys" ;
    ok=1 ;
  fi
  return ${ok} ;
}

# Run a project's pipeline (or one job) with the green-gate framing.
function gitlab_ci_local_run() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";

  if [ ! -d "${project_path}" ]; then
    echo "No such project: ${project_path}";
    return 1 ;
  fi

  gitlab_ci_local_doctor || return 1 ;
  cd "${project_path}" ;

  # Pick the file: --slim prefers the project's committed .gitlab-ci-local.yml
  # (the reproducible subset); otherwise the real pipeline.
  local ci_args="";
  local runner="drupal-ci-local";
  if [ "${SLIM}" == 'yes' ] ; then
    if [ ! -f ".gitlab-ci-local.yml" ]; then
      echo "No .gitlab-ci-local.yml in this project — run without --slim, or add one";
      echo "(see the webship-gitlab-ci-local-runner skill for the pattern).";
      return 1 ;
    fi
    ci_args="--file .gitlab-ci-local.yml";
    runner="gitlab-ci-local";   # the slim file is self-contained, no templates
  elif [ ! -f ".gitlab-ci.yml" ]; then
    echo "No .gitlab-ci.yml here — nothing to run.";
    return 1 ;
  fi

  if [ ! "${VARIABLE}" == '_none_' ] ; then
    ci_args="${ci_args} --variable ${VARIABLE}";
  fi

  # gitignore the artifacts dir once, quietly.
  if [ -d .git ] && ! grep -qs '^\.gitlab-ci-local/' .gitignore 2>/dev/null ; then
    echo ".gitlab-ci-local/" >> .gitignore ;
    echo "Added .gitlab-ci-local/ to .gitignore (artifacts and logs land there)." ;
  fi

  if [ "${LIST}" == 'yes' ] ; then
    ${runner} ${ci_args} --list ;
    return $? ;
  fi

  echo "*---------------------------------------------------------------------*";
  echo "  Green-gate run: ${doc_name}/${PROJECT_NAME}${JOB:+ — job: ${JOB}}";
  echo "*---------------------------------------------------------------------*";

  local output_file;
  output_file=$(mktemp) ;
  if [ -n "${JOB}" ] && [ ! "${JOB}" == '_none_' ] ; then
    ${runner} ${ci_args} "${JOB}" 2>&1 | tee "${output_file}" ;
  else
    ${runner} ${ci_args} 2>&1 | tee "${output_file}" ;
  fi
  local status=${PIPESTATUS[0]} ;

  # Known blocker: gitlab-ci-local crashes evaluating any rule whose =~ regex
  # embeds a $variable (firecow/gitlab-ci-local#1893), and drupal/gitlab_templates
  # has used that pattern for years — every ref, every gitlab-ci-local version.
  # Until that lands upstream, the slim .gitlab-ci-local.yml is the only
  # runnable path for a templates-based project.
  if [ ${status} -ne 0 ] && grep -q 'Error attempting to evaluate the following rules' "${output_file}" ; then
    echo "";
    echo "This is firecow/gitlab-ci-local#1893: a \$variable nested inside an =~ regex";
    echo "crashes rule evaluation, and drupal/gitlab_templates uses that pattern on";
    echo "every ref. The full templates pipeline cannot run locally until that bug";
    echo "is fixed upstream. Run the reproducible subset instead:";
    echo "  bash cmd-tools-gitlab-ci-local.sh ${PROJECT_NAME} --slim";
    echo "(add a .gitlab-ci-local.yml first if the project has none — the";
    echo "webship-gitlab-ci-local-runner skill carries the pattern), and gate the";
    echo "template-only jobs on the remote pipeline.";
  fi
  rm -f "${output_file}" ;

  echo "";
  if [ ${status} -eq 0 ] ; then
    echo "GREEN — every executed job passed. Jobs that cannot run locally are";
    echo "not a pass: gate those on the remote pipeline before merging.";
  else
    echo "RED (exit ${status}) — the push is blocked. Fix the failing job and";
    echo "re-run; never mask it with allow_failure or || true.";
  fi
  cd "${WORKSPACE_ROOT}/${doc_name}";
  return ${status} ;
}
