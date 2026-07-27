#!/bin/usr/env bash

# Sync the skills workspace with the two places skills really live: the shared
# webship/ai-agents repository, and this machine's Claude Code setup in
# ~/.claude/skills. A skill is a folder holding SKILL.md.
#
#   --source repo    (default) pull the shared skills out of webship/ai-agents
#   --source claude  pull this machine's installed skills out of ~/.claude/skills
#   --install        push the workspace's skills into ~/.claude/skills
#
# `--source claude` only takes the skills matching --filter (webship by
# default): a machine's ~/.claude also holds client and third-party skills,
# and this workspace is mirrored to a public repository.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WEBSHIP_WORKSPACE_CONFIG}/workspace.skills.settings.yml);

ARGPARSE_DESCRIPTION="Sync skills with webship/ai-agents or with ~/.claude/skills"
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-s', '--source',
                    default='repo',
                    help='Where to read skills from: repo (webship/ai-agents) or claude (~/.claude/skills). default [ repo ]')
parser.add_argument('-f', '--filter',
                    default='webship',
                    help='Only sync skills whose name starts with this, when reading from claude. Use _all_ for every skill. default [ webship ]')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Push the workspace skills into ~/.claude/skills instead of reading.')
ARGEOF

shift $#;

skills_dir="${WEBSHIP_WORKSPACE_ROOT}/${doc_name}" ;
claude_dir="${HOME}/.claude/skills" ;
repo_url="https://github.com/webship/ai-agents.git" ;
repo_checkout="${WEBSHIP_WORKSPACE_ROOT}/agents/ai-agents" ;

# Copy one skill folder (a directory holding SKILL.md) into a destination.
function copy_skill () {
  local src="$1" dest_root="$2" name ;
  name=$(basename "${src}") ;
  [ -f "${src}/SKILL.md" ] || return 1 ;
  rm -rf "${dest_root}/${name}" ;
  cp -r "${src}" "${dest_root}/" ;
}

if [ "$INSTALL" == 'yes' ]; then
  mkdir -p "${claude_dir}" ;
  installed=0 ;
  for d in "${skills_dir}"/*/ ; do
    [ -d "$d" ] || continue ;
    copy_skill "${d%/}" "${claude_dir}" && installed=$((installed+1)) ;
  done
  echo "Installed ${installed} skills into ${claude_dir}" ;
  exit 0 ;
fi

if [ "$SOURCE" == 'claude' ]; then
  if [ ! -d "${claude_dir}" ]; then
    echo "No ${claude_dir} on this machine — nothing to sync." ;
    exit 1 ;
  fi
  synced=0 ;
  for d in "${claude_dir}"/*/ ; do
    [ -d "$d" ] || continue ;
    name=$(basename "${d%/}") ;
    if [ "$FILTER" != '_all_' ] && [[ "$name" != ${FILTER}* ]]; then
      continue ;
    fi
    copy_skill "${d%/}" "${skills_dir}" && synced=$((synced+1)) ;
  done
  echo "Synced ${synced} skills from ${claude_dir} (filter: ${FILTER})" ;
  exit 0 ;
fi

# Default: the shared webship/ai-agents repository, which keeps its skills in
# .claude/skills. The checkout is shared with cmd-tool-sync-agents.sh. Read the
# files out of the fetched remote branch rather than the checkout's working
# tree, so whatever branch that clone sits on is left alone.
if [ -d "${repo_checkout}/.git" ]; then
  echo "Fetching ${repo_url}" ;
  git -C "${repo_checkout}" fetch --quiet origin || exit 1 ;
else
  echo "Cloning ${repo_url}" ;
  git clone --quiet "${repo_url}" "${repo_checkout}" || exit 1 ;
fi

remote_branch=$(git -C "${repo_checkout}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) ;
remote_branch="${remote_branch:-origin/main}" ;

staging=$(mktemp -d) ;
git -C "${repo_checkout}" archive "${remote_branch}" .claude/skills 2>/dev/null \
  | tar -x -C "${staging}" 2>/dev/null ;

synced=0 ;
for d in "${staging}"/.claude/skills/*/ ; do
  [ -d "$d" ] || continue ;
  copy_skill "${d%/}" "${skills_dir}" && synced=$((synced+1)) ;
done
rm -rf "${staging}" ;

if [ "${synced}" -eq 0 ]; then
  echo "No skills found in ${remote_branch} of webship/ai-agents." ;
  exit 1 ;
fi
echo "Synced ${synced} skills from webship/ai-agents (${remote_branch}) into ${skills_dir}" ;
