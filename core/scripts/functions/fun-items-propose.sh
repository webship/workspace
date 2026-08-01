#!/usr/bin/env bash

# Proposing an agent, a skill or a prompt back to the shared repository.
#
# The file workspaces already pull FROM webship/ai-agents (cmd-tool-sync-*.sh). This is the way
# back: one item, one issue, one pull request.
#
# It is the same shape as proposing a command, and deliberately so — the difference is only which
# repository it goes to and where the item lives inside it. What is shared is the important part:
# nothing is written to the repository here. The plan is printed, and only --confirm hands it to
# the AI agent, which files the issue and opens the PR against a branch, never merging and never
# pushing to the default branch directly.

# Where each kind of item lives in the shared repository, and what one is called.
function items_repo_path() {
  case "$1" in
    agents)  printf '.claude/agents' ;;
    skills)  printf '.claude/skills' ;;
    prompts) printf '.claude/commands' ;;
    *)       return 1 ;;
  esac
}

# The file (or directory, for a skill) an item name refers to.
function items_item_path() {
  local kind="$1" name="$2";
  local base="${WORKSPACE_ROOT}/${kind}";
  if [ "${kind}" == 'skills' ] ; then
    [ -f "${base}/${name}/SKILL.md" ] && printf '%s' "${base}/${name}" && return 0 ;
    return 1 ;
  fi
  [ -f "${base}/${name}.md" ] && printf '%s' "${base}/${name}.md" && return 0 ;
  return 1 ;
}

# Is this item already in the shared repository, and is it the same?
#
# Answered with the gh CLI rather than a clone: one file is wanted, not a repository, and the
# answer is only used to word the issue. When it cannot be answered the proposal still goes ahead
# and says the status is unknown — asserting "a change to" unverified would be worse.
function items_repo_state() {
  local kind="$1" name="$2" local_path="$3";
  local repo_path remote tmp;
  repo_path=$(items_repo_path "${kind}") || return 1 ;

  command -v gh > /dev/null 2>&1 || { printf 'unknown' ; return 0 ; }
  gh api user --jq .login > /dev/null 2>&1 || { printf 'unknown' ; return 0 ; }

  if [ "${kind}" == 'skills' ] ; then
    remote="${repo_path}/${name}/SKILL.md" ;
    local_path="${local_path}/SKILL.md" ;
  else
    remote="${repo_path}/${name}.md" ;
  fi

  tmp=$(mktemp) ;
  if ! gh api "repos/${AI_ITEMS_REPO}/contents/${remote}?ref=${AI_ITEMS_REF}" \
        --jq '.content' 2>/dev/null | base64 -d > "${tmp}" 2>/dev/null ; then
    rm -f "${tmp}" ; printf 'new' ; return 0 ;
  fi
  if cmp -s "${tmp}" "${local_path}" ; then
    rm -f "${tmp}" ; printf 'same' ; return 0 ;
  fi
  rm -f "${tmp}" ; printf 'changed' ;
}

# Print the plan, and only with --confirm hand it over.
function items_propose() {
  local kind="$1" name="$2" summary="$3" confirmed="$4";
  local path state noun;

  case "${kind}" in
    agents)  noun='agent' ;;
    skills)  noun='skill' ;;
    prompts) noun='prompt' ;;
    *) echo "Not a proposable workspace: ${kind}. Only agents, skills and prompts go to ${AI_ITEMS_REPO}." ; return 1 ;;
  esac

  path=$(items_item_path "${kind}" "${name}") || {
    echo "No ${noun} '${name}' in ${kind}/." ; return 1 ;
  }

  state=$(items_repo_state "${kind}" "${name}" "${path}") ;
  case "${state}" in
    same) echo "${kind}/${name} is identical to ${AI_ITEMS_REPO}@${AI_ITEMS_REF} — nothing to propose." ; return 0 ;;
    new)  state="new to" ;;
    changed) state="a change to" ;;
    *)    state="a change of unknown status against" ;
          echo "  (could not read ${AI_ITEMS_REPO} to compare — the agent will work it out)" ;;
  esac

  echo "*---------------------------------------------------------------------*";
  echo "  Propose ${kind}/${name} to ${AI_ITEMS_REPO}";
  echo "*---------------------------------------------------------------------*";
  echo "  ${noun}     ${path}";
  echo "  status    ${state} ${AI_ITEMS_REPO}@${AI_ITEMS_REF}";
  echo "  summary   ${summary}";
  echo "";
  echo "  The AI agent would: file an issue, push a branch, open a PR against";
  echo "  ${AI_ITEMS_REF}, and leave the human-review boxes unticked.";
  echo "  It never merges, and it never pushes to ${AI_ITEMS_REF} directly.";

  if [ ! "${confirmed}" == 'yes' ] ; then
    echo "";
    echo "  Nothing has been created. To go ahead, add --confirm:";
    echo "    bash cmd-tool-propose-${kind}.sh ${name} --summary \"…\" --confirm";
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
  local repo_path;
  repo_path=$(items_repo_path "${kind}") ;
  local prompt;
  prompt="Publish one ${noun} to the ${AI_ITEMS_REPO} repository, following that repository's contribution rules.

File: ${path}
Belongs in: ${repo_path}/ of the repository
Status: it is ${state} ${AI_ITEMS_REPO}@${AI_ITEMS_REF}
What it is for: ${summary}

Do this:
1. Read the file, and read the repository's README/CLAUDE.md so the ${noun} matches how the others are written.
2. File one issue on ${AI_ITEMS_REPO} describing the ${noun} and why it is useful.
3. Push a branch and open ONE pull request against ${AI_ITEMS_REF} containing only this ${noun}, referencing the issue, ending with the Checkpoints checklist.
4. Leave 'Reviewed by a human' and 'Code review by maintainers' unticked. Never merge. Never push to ${AI_ITEMS_REF} directly.
5. Report the issue URL and the pull request URL.

Only this one ${noun}. Do not include unrelated local changes.";

  claude -p "${prompt}" --allowedTools Read Glob Grep Bash --disallowedTools Write Edit --no-session-persistence ;
}
