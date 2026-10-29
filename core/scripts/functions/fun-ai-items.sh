#!/usr/bin/env bash

# Agents, skills and prompts live in three places, and this file is how they
# travel between them:
#
#   1. The workspace folder   ~/workspace/{agents,skills,prompts}/
#      Drafts and work in progress, editable from the dashboard.
#   2. The Claude Code CLI    ~/.claude/{agents,skills,commands}/
#      What an actual session loads.
#   3. The shared repo        github.com/Vardot/dev-ai-agents
#      What the team has, installed there with its own ./sync.sh.
#
# Direction matters:
#   pull   repo   -> workspace folder   (get what the team has)
#   fetch  repo   -> ~/.claude          (use it in sessions now)
#   install workspace -> ~/.claude      (use your draft now; existing verb)
#   promote workspace -> a PR on the repo (share it; that is the agents' job,
#          via github-issue-manager / vardot-mr-pr-manager — never automatic)

# AI_ITEMS_REPO / _REF are resolved in bootstrap.sh from settings.yml
# `sources.ai_items`, because this file is sourced before settings.yml is parsed.

# Where each kind lives, per source. `prompts` is `commands` in the CLI, and in the
# shared repo it is a top-level `prompts/` beside the agents and skills it invokes —
# so the repo path and the project path are two different answers, below.
function ai_items_repo_path() {
  case "$1" in
    ai-agents)  echo ".claude/agents" ;;
    ai-skills)  echo ".claude/skills" ;;
    ai-commands) echo ".claude/commands" ;;
    ai-prompts) echo "prompts" ;;
    *) return 1 ;;
  esac
}

# Where each kind installs INSIDE A PROJECT: always that project's own .claude/,
# which is what a Claude Code session started there reads. Never the repo layout —
# a project's prompts belong in .claude/commands, not in a prompts/ directory.
function ai_items_project_path() {
  case "$1" in
    ai-agents)  echo ".claude/agents" ;;
    ai-skills)  echo ".claude/skills" ;;
    ai-commands) echo ".claude/commands" ;;
    ai-prompts) echo ".claude/commands" ;;
    *) return 1 ;;
  esac
}

function ai_items_claude_path() {
  case "$1" in
    ai-agents)  echo "${HOME}/.claude/agents" ;;
    ai-skills)  echo "${HOME}/.claude/skills" ;;
    ai-commands) echo "${HOME}/.claude/commands" ;;
    ai-prompts) echo "${HOME}/.claude/commands" ;;
    *) return 1 ;;
  esac
}

# Where an install actually lands: globally in ~/.claude, or inside one project's own .claude/,
# which Claude Code reads the same way — a session started under that project sees it, one started
# elsewhere does not. `to` is empty for global, or "<workspace>/<project>" for a project.
function ai_items_install_path() {
  local kind="$1" to="$2" ws project subdir;
  if [ -z "${to}" ] || [ "${to}" == 'claude' ] || [ "${to}" == '_none_' ] ; then
    ai_items_claude_path "${kind}" ;
    return $? ;
  fi
  ws="${to%%/*}"; project="${to#*/}";
  if [ "${ws}" == "${to}" ] || [ -z "${project}" ] ; then
    echo "'--to ${to}' needs a workspace and a project: --to dev/myproject." >&2 ;
    return 1 ;
  fi
  if [ ! -d "${WORKSPACE_ROOT}/${ws}/${project}" ] ; then
    echo "No ${ws}/${project}." >&2 ;
    return 1 ;
  fi
  subdir=$(ai_items_project_path "${kind}") || return 1 ;   # ".claude/agents" etc.
  echo "${WORKSPACE_ROOT}/${ws}/${project}/${subdir}" ;
}

# Same character set clone_ai_item already enforces for a new name. `name` also
# becomes a path component in install_ai_item/ai_items_fetch, so it gets the same
# check before any copy runs.
function ai_items_sanitize_name() {
  local name="$1";
  if [ -z "${name}" ] || [ "${name}" == '_all_' ] ; then
    echo "${name}"; return 0 ;
  fi
  if ! echo "${name}" | grep -qE '^[a-zA-Z0-9_-]+$' ; then
    echo "Invalid name '${name}': letters, digits, hyphen and underscore only." >&2 ;
    return 1 ;
  fi
  echo "${name}";
}

# gh does the authenticated reads; this is a private repository.
#
# Gate on the ACTIVE account, not on `gh auth status`: that command exits
# non-zero when ANY configured account fails, not when the one in use does. The
# dashboard container mounts ~/.config/gh but cannot read the host keyring the
# token is stored in, so it always carries a dead "default" entry alongside a
# perfectly good GH_TOKEN — and the old check refused every repo read there,
# reporting the CLI as unauthenticated while `gh api user` answered fine.
function ensure_gh_cli() {
  if ! command -v gh > /dev/null 2>&1 ; then
    echo "The GitHub CLI is needed to read ${AI_ITEMS_REPO} (private).";
    echo "  install: https://cli.github.com   then: gh auth login";
    return 1 ;
  fi
  # Make a real authenticated call rather than asking gh to self-report.
  #
  # `gh auth status` exits non-zero when ANY configured account fails, so it
  # cannot be used. `gh auth status --active` fixes that but only exists in newer
  # gh: Ubuntu still ships 2.45, where the flag is "unknown flag: --active" and
  # every check would fail. `gh api user` behaves the same on every version and
  # proves the credential actually works, which is the thing being tested.
  # gh's own login first, when settings.yml allows it: on a developer machine gh is already
  # signed in and there is no reason to hold a second credential. Inside the dashboard
  # container it is not — gh reads the same mounted ~/.config/gh, but the token itself lives
  # in the host keyring, which the container cannot read.
  if [ ! "${git_github_use_gh_cli}" == 'false' ] && gh api user --jq .login > /dev/null 2>&1 ; then
    return 0 ;
  fi

  # Then the token from settings.yml. An environment variable still wins over both, and the
  # value is never echoed.
  if [ -z "${GH_TOKEN}" ] && [ -z "${GITHUB_TOKEN}" ] \
     && [ -n "${git_github_token}" ] && [ "${git_github_token}" != 'CHANGE_ME' ]; then
    export GH_TOKEN="${git_github_token}" ;
  fi
  if gh api user --jq .login > /dev/null 2>&1 ; then
    return 0 ;
  fi
  echo "The GitHub CLI is installed but has no working account for ${AI_ITEMS_REPO} (private).";
  echo "";
  if [ -n "${IS_DDEV_PROJECT}" ]; then
    # Inside the dashboard container. `gh auth status` here reports the account from the
    # mounted ~/.config/gh and then calls its token invalid, because the token itself lives
    # in the host keyring, which this container cannot read.
    echo "  You are inside the dashboard container, which has no token of its own.";
    echo "";
    echo "  Run it on the host instead — this works today:";
    echo "      cd ${WORKSPACE_ROOT}/${doc_name} && bash cmd-tools-ai-items.sh --pull";
    echo "";
    echo "  Or set git.github.token at https://${hub_domain:-workspace.ddev.site}/settings — the";
    echo "  dashboard keeps it server-side and this script picks it up with no restart.";
    echo "  Prefer a fine-grained token that can only READ ${AI_ITEMS_REPO}: anything";
    echo "  running in this container, the AI assistant included, can use whatever you set.";
  else
    echo "  Sign in:  gh auth login";
  fi
  return 1 ;
}

# Let git authenticate the way gh does, for the one clone/fetch below.
#
# A token in the environment is enough for `gh api`, but not for git: without a
# credential helper `git clone https://github.com/...` of a private repository
# stops at "could not read Username for 'https://github.com'". Setting the
# helper through GIT_CONFIG_* keeps it to this process — no token on a command
# line, in a URL, or written into anyone's ~/.gitconfig.
function ensure_git_github_auth() {
  export GIT_CONFIG_COUNT=1 ;
  export GIT_CONFIG_KEY_0="credential.https://github.com.helper" ;
  export GIT_CONFIG_VALUE_0="!gh auth git-credential" ;
}

# What the shared repo has, one name per line.
function ai_items_list_remote() {
  local kind="$1";
  local repo_path;
  repo_path=$(ai_items_repo_path "${kind}") || return 1 ;
  ensure_gh_cli || return 1 ;

  if [ "${kind}" == 'ai-skills' ] ; then
    gh api "repos/${AI_ITEMS_REPO}/contents/${repo_path}?ref=${AI_ITEMS_REF}" \
      --jq '.[] | select(.type=="dir") | .name' 2>/dev/null ;
  else
    gh api "repos/${AI_ITEMS_REPO}/contents/${repo_path}?ref=${AI_ITEMS_REF}" \
      --jq '.[] | select(.type=="file") | select(.name|endswith(".md")) | select(.name!="README.md") | .name | sub("\\.md$";"")' 2>/dev/null ;
  fi
}

# Show all three sources side by side, so it is obvious what is where.
function ai_items_status() {
  local kind="${1:-${doc_name}}";
  local claude_dir workspace_dir;
  claude_dir=$(ai_items_claude_path "${kind}") || return 1 ;
  workspace_dir="${WORKSPACE_ROOT}/${kind}";

  echo "*---------------------------------------------------------------------*";
  echo "  ${kind}";
  echo "*---------------------------------------------------------------------*";
  printf "  %-46s %s\n" "workspace  ${workspace_dir}" "$(ai_items_count_local "${kind}" "${workspace_dir}")";
  # A prompt starts a new session; it is not something ~/.claude loads. Showing that
  # column would imply it might.
  if [ ! "${kind}" == 'ai-prompts' ] ; then
    printf "  %-46s %s\n" "claude     ${claude_dir}" "$(ai_items_count_local "${kind}" "${claude_dir}")";
  fi
  if ensure_gh_cli > /dev/null 2>&1 ; then
    printf "  %-46s %s\n" "repo       ${AI_ITEMS_REPO}@${AI_ITEMS_REF}" "$(ai_items_list_remote "${kind}" | wc -l)";
  else
    printf "  %-46s %s\n" "repo       ${AI_ITEMS_REPO}" "(gh not authenticated)";
  fi
}

function ai_items_count_local() {
  local kind="$1" dir="$2";
  if [ ! -d "${dir}" ]; then echo "0 (missing)"; return 0 ; fi
  if [ "${kind}" == 'ai-skills' ] ; then
    find "${dir}" -mindepth 2 -maxdepth 2 -name 'SKILL.md' 2>/dev/null | wc -l ;
  else
    find "${dir}" -maxdepth 1 -name '*.md' ! -name 'README.md' ! -name 'AGENTS.md' ! -name 'CLAUDE.md' 2>/dev/null | wc -l ;
  fi
}

# Copy one item (or all) out of the shared repo into a destination directory.
# dest: "claude" (~/.claude — usable in sessions now) or "workspace".
function ai_items_fetch() {
  local kind="$1" name="$2" dest="$3";
  local repo_path target tmp;
  name=$(ai_items_sanitize_name "${name}") || return 1 ;
  repo_path=$(ai_items_repo_path "${kind}") || return 1 ;
  ensure_gh_cli || return 1 ;

  if [ "${dest}" == 'workspace' ] ; then
    target="${WORKSPACE_ROOT}/${kind}";
  else
    target=$(ai_items_claude_path "${kind}") || return 1 ;
  fi
  mkdir -p "${target}" ;

  # Keep the checkout between runs (a fetch beats a clone), and read the files
  # out of the FETCHED REMOTE BRANCH rather than its working tree — so whatever
  # branch that clone sits on, and any work in progress in it, is left alone.
  local checkout="${WORKSPACE_ROOT}/${kind}/dev-ai-agents";
  tmp=$(mktemp -d) ;
  ensure_git_github_auth ;
  if [ -d "${checkout}/.git" ]; then
    echo "Fetching ${AI_ITEMS_REPO}…" ;
    git -C "${checkout}" fetch --quiet origin || { rm -rf "${tmp}"; return 1 ; }
  else
    echo "Cloning ${AI_ITEMS_REPO}…" ;
    git clone --quiet "https://github.com/${AI_ITEMS_REPO}.git" "${checkout}" || {
      echo "Could not clone — check gh auth and repository access." ; rm -rf "${tmp}"; return 1 ;
    }
  fi

  local remote_branch;
  remote_branch=$(git -C "${checkout}" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null) ;
  remote_branch="${remote_branch:-origin/${AI_ITEMS_REF}}" ;
  git -C "${checkout}" archive "${remote_branch}" "${repo_path}" 2>/dev/null | tar -x -C "${tmp}" || {
    echo "Nothing at ${repo_path} in ${remote_branch}." ; rm -rf "${tmp}"; return 1 ;
  }

  local source_dir="${tmp}/${repo_path}";
  local copied=0;
  local ref_name="${remote_branch#origin/}";

  # Record what was fetched in the lock next to `target`, keyed by the git object sha
  # for that path at the fetched ref — already resolvable from the local clone, no
  # extra network call. Only meaningful for dest=claude: that is the only fetch
  # direction Claude Code actually reads from.
  function _ai_items_lock_fetched() {
    local item="$1" path="$2";
    [ "${dest}" == 'claude' ] || return 0 ;
    local sha; sha=$(git -C "${checkout}" rev-parse "${remote_branch}:${path}" 2>/dev/null) ;
    [ -n "${sha}" ] || return 0 ;
    ai_items_lock_set "${target}" "${kind}" "${item}" \
      "${AI_ITEMS_REPO}@${ref_name}" "repo" "${path}" "${sha}" ;
  }

  if [ -z "${name}" ] || [ "${name}" == '_all_' ] ; then
    if [ "${kind}" == 'ai-skills' ] ; then
      for d in "${source_dir}"/*/ ; do
        [ -f "${d}/SKILL.md" ] || continue ;
        local item; item=$(basename "${d}") ;
        rsync -a --delete "${d}" "${target}/${item}/" && { copied=$((copied+1)); _ai_items_lock_fetched "${item}" "${repo_path}/${item}" ; } ;
      done
    else
      for f in "${source_dir}"/*.md ; do
        case "$(basename "${f}")" in README.md|AGENTS.md|CLAUDE.md) continue ;; esac
        local item; item=$(basename "${f}" .md) ;
        cp "${f}" "${target}/" && { copied=$((copied+1)); _ai_items_lock_fetched "${item}" "${repo_path}/${item}.md" ; } ;
      done
    fi
    echo "Fetched ${copied} ${kind} into ${target}.";
  else
    if [ "${kind}" == 'ai-skills' ] ; then
      if [ ! -f "${source_dir}/${name}/SKILL.md" ]; then
        echo "No skill '${name}' in ${AI_ITEMS_REPO}." ; rm -rf "${tmp}" ; return 1 ;
      fi
      rsync -a --delete "${source_dir}/${name}/" "${target}/${name}/" ;
      _ai_items_lock_fetched "${name}" "${repo_path}/${name}" ;
    else
      if [ ! -f "${source_dir}/${name}.md" ]; then
        echo "No ${kind%s} '${name}' in ${AI_ITEMS_REPO}." ; rm -rf "${tmp}" ; return 1 ;
      fi
      cp "${source_dir}/${name}.md" "${target}/" ;
      _ai_items_lock_fetched "${name}" "${repo_path}/${name}.md" ;
    fi
    echo "Fetched ${name} into ${target}.";
  fi

  rm -rf "${tmp}" ;
  if [ "${dest}" == 'claude' ] ; then
    echo "Restart your Claude Code session to pick it up." ;
  fi
}

# Install one item (or all) from this workspace folder into ~/.claude, or into one project's own
# .claude/ when `to` names one (`<workspace>/<project>`) — same file, same frontmatter `name:`
# Claude Code dispatches on, only the reach differs: global is every session, project-local is only
# sessions started under that project.
function install_ai_item() {
  local kind="$1" name="$2" to="${3:-}";
  name=$(ai_items_sanitize_name "${name}") || return 1 ;
  local src="${WORKSPACE_ROOT}/${kind}";
  local target copied=0;
  target=$(ai_items_install_path "${kind}" "${to}") || return 1 ;
  mkdir -p "${target}" ;

  # Record what was installed from this workspace draft, keyed by a local content
  # hash — no repo involved, so `ai_items_check` recomputes this same hash from
  # the draft's current state instead of calling out anywhere.
  function _ai_items_lock_installed() {
    local item="$1" draft_path="$2";
    local hash; hash=$(ai_items_local_hash "${draft_path}") ;
    [ -n "${hash}" ] || return 0 ;
    ai_items_lock_set "${target}" "${kind}" "${item}" \
      "workspace" "workspace" "${kind}/${item}$([ "${kind}" == 'ai-skills' ] || echo '.md')" "${hash}" ;
  }

  if [ -z "${name}" ] || [ "${name}" == '_all_' ] ; then
    if [ "${kind}" == 'ai-skills' ] ; then
      for d in "${src}"/*/ ; do
        [ -f "${d}/SKILL.md" ] || continue ;
        local item; item=$(basename "${d}") ;
        rsync -a "${d}" "${target}/${item}/" && { copied=$((copied+1)); _ai_items_lock_installed "${item}" "${d}" ; } ;
      done
    else
      for f in "${src}"/*.md ; do
        case "$(basename "${f}")" in README.md|AGENTS.md|CLAUDE.md) continue ;; esac
        [ -f "${f}" ] || continue ;
        local item; item=$(basename "${f}" .md) ;
        cp "${f}" "${target}/" && { copied=$((copied+1)); _ai_items_lock_installed "${item}" "${f}" ; } ;
      done
    fi
    echo "Installed ${copied} ${kind} into ${target}.";
  elif [ "${kind}" == 'ai-skills' ] ; then
    [ -f "${src}/${name}/SKILL.md" ] || { echo "No skill '${name}' in ${src}." ; return 1 ; }
    rsync -a "${src}/${name}/" "${target}/${name}/" ;
    _ai_items_lock_installed "${name}" "${src}/${name}" ;
    echo "Installed ${name} into ${target}.";
  else
    [ -f "${src}/${name}.md" ] || { echo "No ${kind%s} '${name}' in ${src}." ; return 1 ; }
    cp "${src}/${name}.md" "${target}/" ;
    _ai_items_lock_installed "${name}" "${src}/${name}.md" ;
    echo "Installed ${name} into ${target}.";
  fi
  echo "Restart your Claude Code session to pick it up.";
}

# Clone one item under a new name, so it can be customised for a specific need.
#
# A copy is not enough. An agent or skill carries its own name in its YAML
# frontmatter, in its heading, and often in its prose — Claude Code dispatches
# on the frontmatter `name`, so two files claiming the same one collide and
# which definition wins is undefined. Rewriting the identity is the point of
# this function; `cp` is the part that does not matter.
#
# The original is never touched: this only ever writes the new name.
function clone_ai_item() {
  local kind="$1" name="$2" new_name="$3";
  local dir="${WORKSPACE_ROOT}/${kind}";

  if [ -z "${new_name}" ] || [ "${new_name}" == '_none_' ] ; then
    echo "Give the copy a name: --clone-to <new-name>." ;
    return 1 ;
  fi
  if [ "${name}" == '_all_' ] || [ -z "${name}" ] ; then
    echo "Name the item to clone: cmd-tools-ai-items.sh <name> --clone-to <new-name>." ;
    return 1 ;
  fi
  # Same character set the dashboard enforces, so a clone made either way is
  # equally safe to write and to install into ~/.claude.
  if ! echo "${new_name}" | grep -qE '^[a-zA-Z0-9_-]+$' ; then
    echo "Invalid name '${new_name}': letters, digits, hyphen and underscore only." ;
    return 1 ;
  fi

  local src dest;
  if [ "${kind}" == 'ai-skills' ] ; then
    src="${dir}/${name}"; dest="${dir}/${new_name}";
    [ -f "${src}/SKILL.md" ] || { echo "No skill '${name}' in ${dir}." ; return 1 ; }
    [ -e "${dest}" ] && { echo "'${new_name}' already exists — pick another name." ; return 1 ; }
    cp -a "${src}" "${dest}" ;
    rewrite_ai_item_identity "${dest}/SKILL.md" "${name}" "${new_name}" ;
  else
    src="${dir}/${name}.md"; dest="${dir}/${new_name}.md";
    [ -f "${src}" ] || { echo "No ${kind%s} '${name}' in ${dir}." ; return 1 ; }
    [ -e "${dest}" ] && { echo "'${new_name}' already exists — pick another name." ; return 1 ; }
    cp -a "${src}" "${dest}" ;
    rewrite_ai_item_identity "${dest}" "${name}" "${new_name}" ;
  fi

  echo "Cloned ${name} to ${new_name} in ${dir}." ;
  CLONED_AI_ITEM="${dest}";
}

# Point a cloned file at its own name instead of the original's.
function rewrite_ai_item_identity() {
  local file="$1" old="$2" new="$3";
  python3 - "${file}" "${old}" "${new}" <<'PYEOF'
import re, sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()

# One pass over the whole file, which covers the frontmatter `name:` (what Claude
# Code dispatches on), the heading, and every prose reference.
#
# The boundaries are lookarounds over [\w-], not \b. These names are
# hyphenated, and \b treats a hyphen as a boundary — so cloning
# "webship-workspace" to "webship-workspace-client-x" would find the old slug
# inside the name just written and produce "webship-workspace-client-x-client-x".
# Requiring that neither side be a word character or a hyphen also leaves a
# longer sibling name alone.
pattern = r'(?<![\w-])%s(?![\w-])' % re.escape(old)
open(path, 'w').write(re.sub(pattern, new, text))
PYEOF
}

# Hand the clone to Claude Code to tailor and reformat for its new purpose.
#
# Kept separate from the copy: cloning must work with no AI and no network, and
# a failed or absent `claude` may not cost you the clone you already have.
function tailor_ai_item() {
  local kind="$1" file="$2" new_name="$3" purpose="$4";

  if [ -z "${purpose}" ] || [ "${purpose}" == '_none_' ] ; then
    return 0 ;
  fi
  if ! command -v claude > /dev/null 2>&1 ; then
    echo "Claude Code CLI not found — the clone is in place, untailored." ;
    echo "  install: https://claude.com/claude-code" ;
    return 0 ;
  fi

  echo "Tailoring ${new_name} for: ${purpose}" ;
  local kind_note;
  case "${kind}" in
    agents)  kind_note="a Claude Code subagent definition. Keep the YAML frontmatter valid and keep name: ${new_name}. The description: decides when Claude invokes it, so rewrite it for the new purpose and keep the tools: list to what this agent actually needs." ;;
    skills)  kind_note="a Claude Code SKILL.md. Keep the YAML frontmatter valid and keep name: ${new_name}, with a one-line description: saying what it does and when to use it." ;;
    prompts) kind_note="a reusable prompt for a Claude Code slash command. Plain markdown, no frontmatter." ;;
  esac

  local prompt;
  prompt="Rewrite the file at ${file}. It is ${kind_note}

It was cloned from another item and still reads as a generic copy. Tailor it for this purpose: ${purpose}

Keep what genuinely transfers, cut what does not apply, and reformat it so it reads as a purpose-built file rather than an edited copy. Do not invent capabilities, commands, or file paths that do not exist — read the repository if you need to check one. Output ONLY the complete new file content: no commentary, no code fences.";

  local tmp;
  tmp=$(mktemp) ;
  if claude -p "${prompt}" --allowedTools Read Glob Grep --disallowedTools Write Edit Bash \
       --no-session-persistence > "${tmp}" 2>/dev/null && [ -s "${tmp}" ] ; then
    mv "${tmp}" "${file}" ;
    echo "Tailored ${file}." ;
  else
    rm -f "${tmp}" ;
    echo "Claude Code returned nothing — keeping the untailored clone at ${file}." ;
  fi
}

# Hand one draft to the AI agent to file the issue and open the PR on the
# shared repo — the "promote" direction the header describes, and the only way
# anything local reaches ${AI_ITEMS_REPO}.
#
# Confirm-gated on purpose: filing an issue and opening a pull request are
# public acts, so without --confirm this prints exactly what it would do and
# stops.
function ai_items_propose() {
  local kind="$1" name="$2" summary="$3" confirmed="$4";
  name=$(ai_items_sanitize_name "${name}") || return 1 ;
  if [ -z "${name}" ] || [ "${name}" == '_all_' ] ; then
    echo "Name the ${kind%s} to propose: cmd-tools-ai-items.sh <name> --propose --summary \"…\"" ;
    return 1 ;
  fi
  [ "${summary}" == '_none_' ] && summary="";

  local src="${WORKSPACE_ROOT}/${kind}" path repo_path item_repo_path;
  repo_path=$(ai_items_repo_path "${kind}") || return 1 ;
  if [ "${kind}" == 'ai-skills' ] ; then
    path="${src}/${name}";
    [ -f "${path}/SKILL.md" ] || { echo "No skill '${name}' in ${src}." ; return 1 ; }
    item_repo_path="${repo_path}/${name}";
  else
    path="${src}/${name}.md";
    [ -f "${path}" ] || { echo "No ${kind%s} '${name}' in ${src}." ; return 1 ; }
    item_repo_path="${repo_path}/${name}.md";
  fi

  # New to the repo, or a change to what is there — said honestly as unknown
  # when the repository cannot be read (the dashboard container without a token).
  local state="of unknown status against";
  if ensure_gh_cli > /dev/null 2>&1 ; then
    if [ "${kind}" == 'ai-skills' ] ; then
      if gh api "repos/${AI_ITEMS_REPO}/contents/${item_repo_path}?ref=${AI_ITEMS_REF}" > /dev/null 2>&1 ; then
        state="a change to";
      else
        state="new to";
      fi
    else
      local remote_content;
      remote_content=$(gh api "repos/${AI_ITEMS_REPO}/contents/${item_repo_path}?ref=${AI_ITEMS_REF}" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null) ;
      if [ -z "${remote_content}" ] ; then
        state="new to";
      elif [ "${remote_content}" == "$(cat "${path}")" ] ; then
        echo "${kind}/${name} is identical to ${AI_ITEMS_REPO}@${AI_ITEMS_REF} — nothing to propose." ;
        return 0 ;
      else
        state="a change to";
      fi
    fi
  fi
  if [ "${state}" == 'of unknown status against' ] ; then
    echo "  (could not read ${AI_ITEMS_REPO} to compare — the agent will work it out)" ;
  fi

  echo "*---------------------------------------------------------------------*";
  echo "  Propose ${kind}/${name} to ${AI_ITEMS_REPO}";
  echo "*---------------------------------------------------------------------*";
  echo "  file      ${path}";
  echo "  status    ${state} ${AI_ITEMS_REPO}@${AI_ITEMS_REF}";
  echo "  summary   ${summary:-'(no summary given)'}";
  echo "";
  echo "  The AI agent would: file an issue, push a review branch, open a PR";
  echo "  against ${AI_ITEMS_REF}, and leave the human-review boxes unticked.";
  echo "  It never merges, and it never pushes to ${AI_ITEMS_REF} directly.";

  if [ ! "${confirmed}" == 'yes' ] ; then
    echo "";
    echo "  Nothing has been created. To go ahead, add --confirm:";
    echo "    bash cmd-tools-ai-items.sh ${name} --propose --summary \"…\" --confirm";
    return 0 ;
  fi
  if [ -z "${summary}" ] ; then
    echo "";
    echo "  Say what it is for first: --summary \"…\" — it goes into the issue and the PR." ;
    return 1 ;
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
  prompt="Publish one local ${kind%s} to the ${AI_ITEMS_REPO} repository, following the Vardot issue/PR rules and that repository's own RULES.md.

Source: ${path}$([ "${kind}" == 'ai-skills' ] && echo ' (the whole skill directory)')
Belongs at: ${item_repo_path} in the repository
Status: it is ${state} ${AI_ITEMS_REPO}@${AI_ITEMS_REF}
What it is for: ${summary}

Do this:
1. Read the source, and the repository's README/RULES so the item matches how the shared ${kind} are written.
2. File one issue on ${AI_ITEMS_REPO} describing the ${kind%s} and why it is needed.
3. Push a review branch (a fork when forking is enabled, a same-repo feature branch otherwise) and open ONE pull request against ${AI_ITEMS_REF} containing only this item, referencing the issue, ending with the Vardot Checkpoints checklist.
4. Leave 'Reviewed by a human' and 'Code review by maintainers' unticked. Never merge. Never push to ${AI_ITEMS_REF} directly.
5. Report the issue URL and the pull request URL.

Only this one item. Do not include unrelated local changes.";

  claude -p "${prompt}" --allowedTools Read Glob Grep Bash --disallowedTools Write Edit --no-session-persistence ;
}

# Copy this machine's installed items into the workspace folder.
#
# A machine's ~/.claude also holds client and third-party items, and a
# workspace folder can end up in a shared repository — so this direction
# applies a name filter (default "vardot"; "_all_" opts out) rather than
# sweeping everything across.
function ai_items_from_claude() {
  local kind="$1" name="$2" filter="${3:-vardot}";
  local src target synced=0;
  src=$(ai_items_claude_path "${kind}") || return 1 ;
  target="${WORKSPACE_ROOT}/${kind}";

  if [ ! -d "${src}" ]; then
    echo "No ${src} on this machine — nothing to sync." ;
    return 1 ;
  fi
  mkdir -p "${target}" ;

  if [ "${kind}" == 'ai-skills' ] ; then
    for d in "${src}"/*/ ; do
      [ -f "${d}/SKILL.md" ] || continue ;
      local base; base=$(basename "${d}") ;
      if [ ! "${name}" == '_all_' ] && [ -n "${name}" ] && [ ! "${base}" == "${name}" ] ; then continue ; fi
      if [ ! "${filter}" == '_all_' ] && [[ "${base}" != ${filter}* ]] ; then continue ; fi
      rsync -a "${d}" "${target}/${base}/" && synced=$((synced+1)) ;
    done
  else
    for f in "${src}"/*.md ; do
      [ -f "${f}" ] || continue ;
      local base; base=$(basename "${f}" .md) ;
      case "${base}" in README|AGENTS|CLAUDE) continue ;; esac
      if [ ! "${name}" == '_all_' ] && [ -n "${name}" ] && [ ! "${base}" == "${name}" ] ; then continue ; fi
      if [ ! "${filter}" == '_all_' ] && [[ "${base}" != ${filter}* ]] ; then continue ; fi
      cp "${f}" "${target}/" && synced=$((synced+1)) ;
    done
  fi
  echo "Synced ${synced} ${kind} from ${src} (filter: ${filter}) into ${target}.";
}
