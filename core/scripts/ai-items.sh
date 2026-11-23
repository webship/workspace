#!/usr/bin/env bash
## AI items and cmd-* commands from several repositories, into any AI CLI.
##
##   bash core/scripts/ai-items.sh <kind> <verb> [name] [options]
##
##   kind   ai-agents | ai-skills | ai-commands | ai-prompts | cmd
##
##   bash core/scripts/ai-items.sh ai-skills sources                          each source, its state, its items
##   bash core/scripts/ai-items.sh ai-skills source-add webship/ai-agents     owner/repo, an https:// address of a GitHub,
##                                                                            GitLab or Bitbucket repository, or
##                                                                            skills.sh/owner/repo/skill
##        --as <id> --ref <branch> --path <folder> --item <name>
##   bash core/scripts/ai-items.sh ai-skills source-check [<id>]              ask upstream; changes no item
##   bash core/scripts/ai-items.sh ai-skills source-update [<id>] [--force]
##   bash core/scripts/ai-items.sh ai-skills source-remove <id> [--keep-items]
##   bash core/scripts/ai-items.sh cmd source-add <source> --to dev           cmd-*.sh into dev/: placed, never run
##   bash core/scripts/ai-items.sh ai-skills clis                             every AI CLI: on, default, installed, signed in
##   bash core/scripts/ai-items.sh ai-skills items                            each item against the CLIs that are on
##   bash core/scripts/ai-items.sh ai-skills install <name> --cli gemini      --cli all = every CLI that is on;
##                                                                            --to dev/site = that project only
##   bash core/scripts/ai-items.sh ai-skills uninstall <name> --cli gemini
##                                                                            a file no install put there is left
##                                                                            unless --force
##
##   bash core/scripts/ai-items.sh roles                                      who writes, who reviews, who gives a second
##                                                                            opinion on a spec, and whether each can run
##   bash core/scripts/ai-items.sh run --role author --spec specs/dev/site/001-topic "<task>"
##   bash core/scripts/ai-items.sh run --role reviewer --spec specs/dev/site/001-topic --evidence <report> "<task>"
##        --cli <id> another CLI for this run; --agent <name>; --minutes <n> (default 20)
##        Runs that CLI's own non-interactive form and keeps the answer in <spec>/collaboration/.
##        A role whose CLI is off, missing, signed out or the author's own is written down as skipped.
##        Exit: 0 answered, 3 skipped, 1 failed. A person decides: nothing is merged or marked reviewed.
##
## The CLIs are data: core/config/ai.defaults.yml, with this machine's core/config/ai.settings.yml over
## it. A CLI or a source added there shows up here and in the dashboard with no code change.
## What is fetched is files only: shown, never run. See core/docs/ai-items-any-cli.md.

set -u
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}";
WORKSPACE_ROOT="${WORKSPACE_ROOT:-$(cd "${WORKSPACE_SCRIPTS}/../.." && pwd)}";
export WORKSPACE_ROOT ;
# The engine lives beside these scripts (not necessarily under WORKSPACE_ROOT: a test points the root
# at a temporary tree while the code stays here).
APP="$(cd "${WORKSPACE_SCRIPTS}/../workspace-app" && pwd)";

usage() { awk 'NR > 1 && !/^##/ { exit } NR > 1 { sub(/^## ?/, ""); print }' "${BASH_SOURCE[0]}"; }

if { [ $# -lt 2 ] && [ ! "${1:-}" == 'roles' ] ; } || [ "${1:-}" == '--help' ] || [ "${1:-}" == '-h' ] ; then
  usage ;
  [ $# -ge 1 ] && { [ "$1" == '--help' ] || [ "$1" == '-h' ] ; } && exit 0 ;
  exit 2 ;
fi

if ! command -v node > /dev/null 2>&1 ; then
  echo "Node.js is needed for this (the dashboard's own runtime)." >&2 ;
  exit 1 ;
fi
# The engine (ai-anycli) is the next to become TypeScript, which Node.js strips itself from 22.18 on: the version the
# package asks for. An older Node.js is refused here first, with the version it needs (as screen-host.sh does, #797).
if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' 2> /dev/null ; then
  echo "node $(node --version 2> /dev/null) is too old for this: it needs Node.js 22.18 or later." >&2 ;
  echo "Install a newer one with:  bash ${WORKSPACE_SCRIPTS}/install.sh" >&2 ;
  exit 1 ;
fi

exec node "${APP}/ai-anycli-cli.js" "$@" < /dev/null
