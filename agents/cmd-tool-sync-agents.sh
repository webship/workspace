#!/usr/bin/env bash

# Sync the agents workspace with the two places agents really live: the shared
# webship/ai-agents repository, and this machine's Claude Code setup in
# ~/.claude/agents.
#
#   --source repo    (default) pull the shared agents out of webship/ai-agents
#   --source claude  pull this machine's installed agents out of ~/.claude/agents
#   --install        push the workspace's agents into ~/.claude/agents
#
# `--source claude` only takes the agents matching --filter (webship by
# default): a machine's ~/.claude also holds client and third-party agents,
# and this workspace is mirrored to a public repository.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings and extra lists.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.agents.settings.yml);

ARGPARSE_DESCRIPTION="Sync agents with webship/ai-agents or with ~/.claude/agents"
argparse "$@" <<ARGEOF || exit 1
parser.add_argument('-s', '--source',
                    default='repo',
                    help='Where to read agents from: repo (webship/ai-agents) or claude (~/.claude/agents). default [ repo ]')
parser.add_argument('-f', '--filter',
                    default='webship',
                    help='Only sync agents whose name starts with this, when reading from claude. Use _all_ for every agent. default [ webship ]')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Push the workspace agents into ~/.claude/agents instead of reading.')
ARGEOF

shift $#;

agents_dir="${WORKSPACE_ROOT}/${doc_name}" ;
claude_dir="${HOME}/.claude/agents" ;
repo_url="https://github.com/webship/ai-agents.git" ;
repo_checkout="${agents_dir}/ai-agents" ;

if [ "$INSTALL" == 'yes' ]; then
  mkdir -p "${claude_dir}" ;
  installed=0 ;
  for f in "${agents_dir}"/*.md ; do
    [ -f "$f" ] || continue ;
    [ "$(basename "$f")" == "README.md" ] && continue ;
    cp "$f" "${claude_dir}/" && installed=$((installed+1)) ;
  done
  echo "Installed ${installed} agents into ${claude_dir}" ;
  exit 0 ;
fi

if [ "$SOURCE" == 'claude' ]; then
  if [ ! -d "${claude_dir}" ]; then
    echo "No ${claude_dir} on this machine — nothing to sync." ;
    exit 1 ;
  fi
  synced=0 ;
  for f in "${claude_dir}"/*.md ; do
    [ -f "$f" ] || continue ;
    name=$(basename "$f") ;
    if [ "$FILTER" != '_all_' ] && [[ "$name" != ${FILTER}* ]]; then
      continue ;
    fi
    cp "$f" "${agents_dir}/" && synced=$((synced+1)) ;
  done
  echo "Synced ${synced} agents from ${claude_dir} (filter: ${FILTER})" ;
  exit 0 ;
fi

# Default: the shared webship/ai-agents repository, which keeps its agents in
# .claude/agents. Read the files out of the fetched remote branch rather than
# the checkout's working tree, so whatever branch that clone sits on — or any
# work in progress in it — is left alone.
if [ -d "${repo_checkout}/.git" ]; then
  echo "Fetching ${repo_url}" ;
  git -C "${repo_checkout}" fetch --quiet origin || exit 1 ;
else
  echo "Cloning ${repo_url}" ;
  git clone --quiet "${repo_url}" "${repo_checkout}" || exit 1 ;
fi

remote_branch=$(git -C "${repo_checkout}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) ;
remote_branch="${remote_branch:-origin/main}" ;

synced=$(git -C "${repo_checkout}" archive "${remote_branch}" .claude/agents 2>/dev/null \
  | tar -x -C "${agents_dir}" --strip-components=2 --wildcards '*.md' --show-transformed-names -v 2>/dev/null \
  | wc -l) ;

if [ "${synced}" -eq 0 ]; then
  echo "No agents found in ${remote_branch} of webship/ai-agents." ;
  exit 1 ;
fi
echo "Synced ${synced} agents from webship/ai-agents (${remote_branch}) into ${agents_dir}" ;
