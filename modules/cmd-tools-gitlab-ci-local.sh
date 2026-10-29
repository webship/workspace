#!/usr/bin/env bash

# Run a project's GitLab CI pipeline locally with gitlab-ci-local — the Webship
# green-gate before any push to git.drupalcode.org. Wires the
# drupal/gitlab_templates remote variables through the drupal-ci-local wrapper
# (installed on first run), checks Docker and SSH, and reports GREEN/RED.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.modules.settings.yml);

ARGPARSE_DESCRIPTION="Run a modules project's GitLab CI pipeline locally (the green-gate)"
source ${WORKSPACE_SCRIPTS}/args/arg-gitlab-ci-local.sh || exit 1 ;

shift $#;

if [ "${DOCTOR}" == 'yes' ] ; then
  gitlab_ci_local_doctor && echo "Everything a green-gate run needs is in place." ;
else
  gitlab_ci_local_run ;
fi
