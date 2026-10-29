#!/usr/bin/env bash

################################################################################
## Extra hostnames for a project — the same site at another address.
################################################################################
## A DDEV project answers at `<name>.<project_tld>` because the NAME decides the
## address, and the workspace hands out a second, hierarchical one
## (`<project>.<workspace>.workspace.ddev.site`) through its own nginx tier. What
## neither gives you is a THIRD shape people keep asking for: the same project
## name in two workspaces, told apart in one flat hostname —
## `test3-dev.ddev.site` and `test3-test.ddev.site`.
##
## That is DDEV's `additional_hostnames`, and it is deliberately what this uses
## rather than renaming the project:
##
##   * ADDING a hostname is reversible and costs nothing. RENAMING kills the old
##     URL, recreates the containers and volumes under the new name, and leaves
##     the DDEV project name no longer matching the folder — which is precisely
##     what makes a git worktree collide with its source (fun-clone-project.sh).
##   * Several addresses can coexist. A rename gives you exactly one, and takes
##     one away.
##   * Every link already printed, bookmarked or written in a doc keeps working.
##
## Written through `ddev config --additional-hostnames=`, never by editing the
## YAML: DDEV owns that file, validates the names and rewrites the router
## configuration. The list is REPLACED by that flag, so anything here that adds
## one reads the current list first and writes it back whole — an add that
## silently dropped the other hostnames would be worse than no add at all.
##
## A change only reaches the router on the next start, so these functions say so
## and offer to do it rather than leaving a hostname that resolves to nothing.
################################################################################

# The additional_hostnames a project currently declares, one per line.
# Read from the project's own config.yaml, which is the file the flag writes, so
# what is read and what is written cannot disagree.
function ddev_hostnames_list() {
  local dir="${1:-}" cfg
  cfg="${dir}/.ddev/config.yaml"
  [ -f "${cfg}" ] || return 0
  # The block is `additional_hostnames:` followed by `- name` lines, or an inline
  # `[a, b]`. Both shapes are legal YAML and DDEV writes the first.
  python3 - "${cfg}" <<'PY' 2>/dev/null
import sys, re
try:
    lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
except Exception:
    sys.exit(0)
out, inblock = [], False
for ln in lines:
    if re.match(r'^additional_hostnames:', ln):
        rest = ln.split(':', 1)[1].strip()
        if rest.startswith('['):
            out += [x.strip().strip('"\'') for x in rest.strip('[]').split(',') if x.strip()]
        else:
            inblock = True
        continue
    if inblock:
        m = re.match(r'^\s+-\s*(.+?)\s*$', ln)
        if m:
            out.append(m.group(1).strip().strip('"\''))
            continue
        if ln.strip() == '' or ln.startswith(' '):
            continue
        inblock = False
for h in out:
    if h and h != '[]':
        print(h)
PY
}

# The hostname a project would get from its workspace: <project>-<workspace>.
# One flat name that is unique across workspaces, which is the whole point —
# `test3` in dev and `test3` in test cannot both be `test3.ddev.site`.
function ddev_workspace_hostname() {
  local project="${1:-}" workspace="${2:-}"
  [ -n "${project}" ] && [ -n "${workspace}" ] || return 0
  # DDEV allows letters, digits and hyphens in a hostname; a workspace key can
  # carry a hyphen already (site-templates), which is fine, and nothing else.
  echo "${project}-${workspace}" | tr -c 'a-zA-Z0-9-\n' '-'
}

# Is this a hostname DDEV will accept? Refused here rather than after a failed
# `ddev config`, because the message DDEV gives is about its whole config file.
function ddev_hostname_valid() {
  local h="${1:-}"
  [ -n "${h}" ] || return 1
  # A label, not an FQDN: additional_hostnames gets project_tld appended. A dot
  # here would silently produce name.example.com.ddev.site.
  echo "${h}" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$'
}

# Add one or more hostnames, keeping the ones already there.
function ddev_hostnames_add() {
  local dir="${1}" ; shift
  local cfg="${dir}/.ddev/config.yaml" tld existing all h added=0
  if [ ! -f "${cfg}" ] ; then
    echo "Not a DDEV project: ${dir}" ; return 1 ;
  fi
  existing="$(ddev_hostnames_list "${dir}")"
  all="${existing}"
  for h in "$@" ; do
    [ -n "${h}" ] || continue
    if ! ddev_hostname_valid "${h}" ; then
      echo "  '${h}' is not a hostname label — letters, digits and hyphens only, and no dots" ;
      echo "  (the project's TLD is appended, so a dot here would give name.example.com.<tld>)." ;
      return 1 ;
    fi
    if echo "${existing}" | grep -qx "${h}" ; then
      echo "  ${h} is already there." ; continue ;
    fi
    # Two projects claiming one hostname is a router conflict, and it is invisible
    # one project at a time: whichever started last wins, and the other simply
    # stops answering at an address that used to work. Checked across the whole
    # tree, not just this workspace, because the router is one thing for all of
    # them — and against DDEV's project NAMES too, since the canonical hostname
    # comes from the name and would be shadowed just the same.
    local owner
    owner="$(ddev_hostname_owner "${h}" "${dir}")"
    if [ -n "${owner}" ] ; then
      echo "  '${h}' is already taken by ${owner}." ;
      echo "  Two projects on one hostname is a router conflict: the last one to" ;
      echo "  start wins and the other quietly stops answering. Pick another." ;
      return 1 ;
    fi
    all="$(printf '%s\n%s' "${all}" "${h}")"
    added=$((added+1)) ;
  done
  [ "${added}" -eq 0 ] && return 0 ;

  # Written whole, because the flag replaces the list.
  local joined
  joined="$(echo "${all}" | grep -v '^$' | paste -sd, -)"
  ( cd "${dir}" && ddev config --additional-hostnames="${joined}" > /dev/null ) || {
    echo "  ddev refused the hostname list: ${joined}" ; return 1 ;
  }
  tld="$(ddev_project_tld)"
  echo "  Hostnames for this project are now:" ;
  ddev_hostnames_list "${dir}" | sed "s|^|    https://|; s|\$|.${tld}|" ;
  echo "" ;
  echo "  A hostname reaches the router only on the next start:" ;
  echo "    cd ${dir} && ddev start" ;
}

# Remove one hostname, leaving the rest.
function ddev_hostnames_remove() {
  local dir="${1}" h="${2}" cfg="${dir}/.ddev/config.yaml" kept
  [ -f "${cfg}" ] || { echo "Not a DDEV project: ${dir}" ; return 1 ; }
  if ! ddev_hostnames_list "${dir}" | grep -qx "${h}" ; then
    echo "  ${h} is not one of this project's additional hostnames." ; return 1 ;
  fi
  kept="$(ddev_hostnames_list "${dir}" | grep -vx "${h}" | paste -sd, -)"
  ( cd "${dir}" && ddev config --additional-hostnames="${kept}" > /dev/null ) || return 1 ;
  echo "  Removed ${h}. Remaining: ${kept:-none}" ;
  echo "  The router still holds the old route until the next start." ;
}

# Which project, anywhere in the tree, already answers at this hostname label —
# whether as its DDEV name or as one of its additional hostnames. Empty when the
# label is free. `skip_dir` is the project asking, so it does not find itself.
function ddev_hostname_owner() {
  local h="${1}" skip_dir="${2:-}" d p n
  local skip_real
  skip_real="$( (cd "${skip_dir}" 2>/dev/null && pwd -P) || echo "${skip_dir}")"
  for d in "${WORKSPACE_ROOT}"/*/*/ ; do
    [ -f "${d}/.ddev/config.yaml" ] || continue
    [ "$( (cd "${d}" && pwd -P) )" == "${skip_real}" ] && continue
    n="$(ddev_project_name "${d}" 2>/dev/null)"
    p="$(basename "$(dirname "${d}")")/$(basename "${d}")"
    if [ "${n}" == "${h}" ] ; then
      echo "${p} (it is that project's own name)" ; return 0 ;
    fi
    if ddev_hostnames_list "${d}" | grep -qx "${h}" ; then
      echo "${p} (an additional hostname there)" ; return 0 ;
    fi
  done
  return 0
}

# The TLD every project hostname is under. Global unless the project overrides it.
function ddev_project_tld() {
  local dir="${1:-}" tld=''
  if [ -n "${dir}" ] && [ -f "${dir}/.ddev/config.yaml" ] ; then
    tld="$(sed -n 's/^project_tld:[[:space:]]*"\{0,1\}\([^"#]*\)"\{0,1\}[[:space:]]*$/\1/p' "${dir}/.ddev/config.yaml" | head -1 | tr -d '[:space:]')"
  fi
  if [ -z "${tld}" ] ; then
    tld="$(ddev config global 2>/dev/null | sed -n 's/^project-tld=//p' | head -1 | tr -d '[:space:]')"
  fi
  echo "${tld:-ddev.site}"
}

# Everything one project answers at, for a report or a confirmation.
function ddev_hostnames_report() {
  local dir="${1}" project="${2:-}" workspace="${3:-}" tld name
  tld="$(ddev_project_tld "${dir}")"
  name="$(ddev_project_name "${dir}" 2>/dev/null)"
  echo "  canonical    https://${name:-${project}}.${tld}" ;
  [ -n "${workspace}" ] && echo "  hierarchical https://${project}.${workspace}.$(workspace_hub_domain)" ;
  local extra
  extra="$(ddev_hostnames_list "${dir}")"
  if [ -n "${extra}" ] ; then
    echo "  additional:" ;
    echo "${extra}" | sed "s|^|    https://|; s|\$|.${tld}|" ;
  else
    echo "  additional   none" ;
  fi
}

# The hub domain the dashboard hands out, from settings.yml — one field, and the
# only place the hierarchical URLs come from.
function workspace_hub_domain() {
  echo "${hub_domain:-workspace.ddev.site}"
}
