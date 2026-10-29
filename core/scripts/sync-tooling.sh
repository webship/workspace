#!/usr/bin/env bash

# Copy the tooling from the Webship Workspace git clone into the live workspace
# it is checked out inside — the step that follows every merged PR.
#
#   ~/workspace/products/workspace   the clone: where commits and PRs happen
#   ~/workspace                      the live tree: where projects are built
#
# It syncs the shared core/, each workspace folder's cmd-*.sh, README.md and
# *.code-workspace, and prunes commands the clone no longer ships. Built
# project content is never touched.
#
# core/config/settings.yml is DELIBERATELY not synced: the live copy holds the
# real account password and API keys, while the committed one ships CHANGE_ME
# and sk-change-this placeholders. Only the `workspaces:` list is reconciled,
# and only by reporting what is missing.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;


ARGPARSE_DESCRIPTION="Sync the workspace tooling from the git clone into the live workspace"
argparse "$@" <<EOF || exit 1
parser.add_argument('CLONE_NAME',
                    default='workspace',
                    nargs='?',
                    help='The clone directory inside the products workspace [default %(default)s].')
parser.add_argument('-p', '--pull',
                    action='store_true',
                    default=False,
                    help='git pull the clone first (fast-forward only), so a merged PR is picked up.')
parser.add_argument('-n', '--dry-run',
                    action='store_true',
                    default=False,
                    help='Show what would change and copy nothing.')
parser.add_argument('-s', '--skip-tests',
                    action='store_true',
                    default=False,
                    help='Skip the smoke test that normally runs after the sync.')
EOF

shift $#;

# The clone lives in the products workspace: it is a Webship product like any other.
source_root="${WORKSPACE_ROOT}/products/${CLONE_NAME}";
# Where this script itself is, so the prune below cannot delete the file it is running from.
self_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")";
target_root="${WORKSPACE_ROOT}";

if [ ! -d "${source_root}/core/scripts" ]; then
  echo "No workspace clone at ${source_root}.";
  echo "Expected the git checkout of webship/workspace there.";
  exit 1 ;
fi

if [ "${source_root}" == "${target_root}" ]; then
  echo "The clone and the live workspace are the same directory — nothing to sync.";
  exit 1 ;
fi

rsync_flags="-a";
if [ "${DRY_RUN}" == 'yes' ] ; then
  rsync_flags="-a --dry-run --itemize-changes";
  echo "DRY RUN — nothing will be written.";
fi

echo "*---------------------------------------------------------------------*";
echo "  Sync tooling";
echo "    from ${source_root}";
echo "      to ${target_root}";
echo "*---------------------------------------------------------------------*";

if [ "${PULL}" == 'yes' ] ; then
  echo "";
  echo "Updating the clone…";
  (cd "${source_root}" && git pull --ff-only) || {
    echo "git pull failed — resolve the clone's state first, then re-run.";
    exit 1 ;
  }
fi

echo "";
echo "Clone is at: $(cd "${source_root}" && git log --oneline -1 2>/dev/null || echo 'not a git checkout')";

# Shared scripts: mirrored, so a deleted function or arg file disappears here too.
echo "";
echo "→ core/scripts";
rsync ${rsync_flags} --delete "${source_root}/core/scripts/" "${target_root}/core/scripts/" ;

# Per-workspace settings only. settings.yml stays local: it holds real secrets.
echo "→ core/config/workspace.*.settings.yml";
rsync ${rsync_flags} "${source_root}"/core/config/workspace.*.settings.yml "${target_root}/core/config/" ;

# The dashboard, minus what belongs to the running instance.
echo "→ core/workspace-app";
rsync ${rsync_flags} --exclude=node_modules --exclude=actions.log --exclude=logs --exclude=.chats --exclude=.memory --exclude=.voice-cache --exclude=.auth \
  "${source_root}/core/workspace-app/" "${target_root}/core/workspace-app/" ;

# Each workspace folder's commands and docs — never its built projects.
# AGENTS.md and CLAUDE.md come across too: they are what a Claude Code session
# started anywhere under a workspace reads to find its context and its rules.
echo "→ <workspace>/cmd-*.sh, README.md, AGENTS.md, CLAUDE.md, *.code-workspace";
for workspace_dir in "${source_root}"/*/ ; do
  workspace_name=$(basename "${workspace_dir}");
  # A workspace on second storage whose drive is not mounted: writing through the dangling link would
  # recreate its folder under the mount point, on the wrong disk. Skip it and say so.
  if [ -L "${target_root}/${workspace_name}" ] && [ ! -d "${target_root}/${workspace_name}" ] ; then
    echo "   skipped ${workspace_name}: it links to $(readlink "${target_root}/${workspace_name}"), which is not mounted" ;
    continue ;
  fi
  [ -d "${target_root}/${workspace_name}" ] || mkdir -p "${target_root}/${workspace_name}" ;
  # scripts/ carries the assets a builder copies into a project. It is empty for
  # the site templates now that the front-end libraries come from Composer, but
  # the include stays: a builder that needs to ship an asset again should not
  # have to rediscover why the file never reached the live tree.
  rsync ${rsync_flags} --include='cmd-*.sh' --include='README.md' --include='AGENTS.md' \
    --include='CLAUDE.md' --include='*.code-workspace' \
    --include='scripts/' --include='scripts/**' \
    --exclude='*' "${workspace_dir}" "${target_root}/${workspace_name}/" ;
done

# The specs workspace is the one whose CONTENT is the deliverable rather than its commands: the
# templates every spec starts from, and the constitution of each product. Those are committed, so
# a --pull that skipped them left a machine with the command and none of the material it reads —
# `-a constitution` would answer "no template", on a tree that has one in the repository.
#
# Only the two shared kinds. A numbered spec is about one change in one tree and belongs to
# whoever is making it.
if [ -d "${source_root}/specs" ] ; then
  echo "→ specs/_defaults and every 00-constitution.md";
  rsync ${rsync_flags} --include='_defaults/' --include='_defaults/**' \
    --include='*/' --include='00-constitution.md' \
    --exclude='*' "${source_root}/specs/" "${target_root}/specs/" ;
fi

# core/workspace-app was just mirrored, and two files in it carry THIS machine's docker
# GID — the Dockerfile's group and the compose group_add. The clone cannot know that
# number, so a pull would leave the dashboard unable to reach Docker: every project
# Stopped, no Start/Stop item, and nothing to suggest a permissions problem. Re-align
# it here, where the overwrite happened.
if [ -f "${WORKSPACE_SCRIPTS}/docker-gid.sh" ] && [ "${DRY_RUN}" != 'yes' ] ; then
  echo "";
  echo "→ the dashboard's Docker access";
  bash "${WORKSPACE_SCRIPTS}/docker-gid.sh" || true ;
fi

# The same for the second storage: the mounts that let the dashboard follow a workspace symlink onto
# another disk are this machine's paths, generated from storage.second. Rewritten only when they differ.
if [ -f "${WORKSPACE_SCRIPTS}/storage.sh" ] && [ "${DRY_RUN}" != 'yes' ] ; then
  bash "${WORKSPACE_SCRIPTS}/storage.sh" --mounts --quiet || true ;
fi

# The tree's own root CLAUDE.md — the file that tells a session how to work out which
# workspace it is in. Placed only when missing: it is a live-tree file, and
# overwriting it would discard whatever this machine has added.
if [ ! -f "${target_root}/CLAUDE.md" ] && [ -f "${source_root}/core/templates/workspace-root-CLAUDE.md" ] ; then
  cp "${source_root}/core/templates/workspace-root-CLAUDE.md" "${target_root}/CLAUDE.md" ;
  echo "   placed ${target_root}/CLAUDE.md from the template (it was missing)" ;
fi

# Commands the clone dropped (a removed builder, a renamed tool).
echo "";
echo "→ pruning commands the clone no longer ships";
pruned=0;
cd "${target_root}";
for command_file in */cmd-*.sh ; do
  [ -f "${command_file}" ] || continue ;
  # Never delete the script performing the sync. This is not hypothetical: the release
  # that moved autostart, brand-tokens and sync-tooling into core/scripts is pulled BY
  # the old products/cmd-tools-sync-tooling.sh, which the clone no longer ships — and
  # bash reads a script as it executes, so removing it mid-run can truncate the rest.
  if [ "$(cd "$(dirname "${command_file}")" && pwd)/$(basename "${command_file}")" == "${self_path}" ] ; then
    echo "   keeping ${command_file} — it is running this sync. Delete it by hand, then use";
    echo "   core/scripts/$(basename "${command_file}" | sed 's/^cmd-tools-//') from now on.";
    continue ;
  fi
  if [ ! -f "${source_root}/${command_file}" ]; then
    if [ "${DRY_RUN}" == 'yes' ] ; then
      echo "   would remove ${command_file}";
    else
      rm -f "${command_file}";
    fi
    pruned=$((pruned+1));
  fi
done
echo "   ${pruned} stale command(s)";

# settings.yml is not copied, so a workspace added in the clone would be
# invisible here. Report it rather than editing a file with real secrets.
echo "";
echo "→ checking the workspaces: list";
missing_workspaces="";
for workspace_name in $(grep -A100 '^workspaces:' "${source_root}/core/config/settings.yml" | grep '^  - ' | sed 's/^  - //') ; do
  if ! grep -q "^  - ${workspace_name}$" "${target_root}/core/config/settings.yml" ; then
    missing_workspaces="${missing_workspaces} ${workspace_name}";
  fi
done
if [ -n "${missing_workspaces}" ]; then
  echo "   MISSING from your ${target_root}/core/config/settings.yml:${missing_workspaces}";
  echo "   Add them to its workspaces: list — it is not synced because it holds your real";
  echo "   account password and API keys. The list order is the dashboard card order.";
else
  echo "   up to date";
fi

if [ "${DRY_RUN}" == 'yes' ] ; then
  echo "";
  echo "DRY RUN — nothing was written.";
  exit 0 ;
fi

echo "";
  # Stamp the version this pull brought in. The clone IS a checkout, so the tag it sits on
  # is the honest answer — and without this a machine that keeps up to date via the clone
  # reports "(untracked)" to update.sh for ever and is told to update to what it already has.
  if command -v workspace_clone_version > /dev/null 2>&1 ; then
    sync_tag="$(workspace_clone_version "${source_root}")" ;
    if [ -n "${sync_tag}" ] ; then
      WORKSPACE_PATH="${target_root}/core" workspace_version_stamp "${sync_tag}" \
        && echo "→ recorded this tree as ${sync_tag}" ;
    else
      echo "→ the clone is on no tag, so the version is not recorded" ;
    fi
  fi

if [ ! "${SKIP_TESTS}" == 'yes' ] ; then
  echo "";
  echo "→ smoke test";
  (cd "${target_root}" && bash core/scripts/tests/cmd-smoke-test.sh 2>&1 | tail -3) ;
fi

echo "";
echo "*---------------------------------------------------------------------*";
echo "  Synced.";
echo "";
echo "  If core/workspace-app/.ddev/ or its Dockerfile changed, rebuild the";
echo "  dashboard container so it picks that up — when no build jobs are";
echo "  running, because the job registry is in memory:";
echo "    cd ${target_root}/core/workspace-app && ddev restart";
echo "";
echo "  For a change to server.js or workspaces.js alone, restarting the app";
echo "  is enough (supervisord respawns it):";
echo "    docker exec ddev-workspace-web sh -c 'pkill -f \"node server.js\"'";
echo "*---------------------------------------------------------------------*";
