#!/usr/bin/env bash
# Smoke-test every cmd-*.sh in every workspace folder, plus the machine-level scripts
# in core/scripts that used to be cmd-*.sh in one.
#
# For each script:
#  1. bash -n            — syntax check (always)
#  2. --help execution   — only for argparse-based scripts (safe: argparse
#                          prints usage and exits before any real work),
#                          which exercises bootstrap.sh, parse_yaml, the
#                          workspace + distribution configs and arg-*.sh
#  3. the last call      — the function a script ends by calling exists, and a builder that
#                          ends with build_distribution has its install function
#  4. workspace-name     — builder scripts must carry the "# workspace-name:"
#                          header the dashboard shows in Build dropdowns
#
# Exit code: number of failing scripts (0 = all green).

# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1

pass=0; fail=0; failures=()

# The registered workspaces, plus commands/ — which is a Settings section rather than
# a workspace, but still ships a cmd-*.sh that must pass the same checks. Without it
# here, deregistering that folder silently dropped its script from the run.
# The machine-level scripts: autostart.sh and sync-tooling.sh were
# cmd-*.sh in products/ until they moved here, and moving a script out of a workspace
# folder must not quietly drop it from the run — that happened once already, to
# commands/. Named explicitly rather than globbed, because core/scripts is also full
# of libraries and bootstrap files that are sourced, never run. So every NEW machine
# script has to be added here by hand — host-mounts.sh and upsun-ai.sh had been
# sitting in core/scripts untested because that step was missed.
MACHINE_SCRIPTS=(autostart.sh sync-tooling.sh install.sh trust-https.sh docker-gid.sh host-mounts.sh storage.sh plugins.sh)

for ws in "${workspaces[@]}" commands core/scripts; do
  dir="${WORKSPACE_ROOT}/${ws}"
  [ -d "$dir" ] || continue
  if [ "$ws" == 'core/scripts' ] ; then
    scripts=()
    for name in "${MACHINE_SCRIPTS[@]}"; do
      [ -f "${dir}/${name}" ] && scripts+=("${dir}/${name}")
    done
  else
    scripts=("$dir"/cmd-*.sh)
  fi
  for f in "${scripts[@]}"; do
    [ -f "$f" ] || continue
    rel="${ws}/$(basename "$f")"
    err=""

    # 1. Syntax
    if ! bash -n "$f" 2>/tmp/cmd-smoke-err; then
      err="syntax: $(head -1 /tmp/cmd-smoke-err)"
    fi

    # 2. argparse scripts: run --help (safe, exercises the full bootstrap chain)
    if [ -z "$err" ] && grep -q 'argparse "\$@"\|arg-${distribution_name}\|arg-\${distribution_name}\|--help)' "$f"; then
      if ! (cd "$dir" && timeout 30 bash "$f" --help >/tmp/cmd-smoke-out 2>&1); then
        # argparse exits non-zero on --help in some versions; accept if usage was printed
        if ! grep -qi "usage" /tmp/cmd-smoke-out; then
          err="--help: $(tail -1 /tmp/cmd-smoke-out | cut -c1-120)"
        fi
      fi
    fi

    # 3. The function the script ends by calling must actually EXIST after bootstrap.
    #    `--help` returns before that line, so a script whose function file was never added to
    #    bootstrap-functions.sh passes every check above and then dies with "command not found"
    #    the first time it is run for real. That is how sixteen site-template builders shipped.
    if [ -z "$err" ]; then
      for fn in $(grep -oE '^[a-z_][a-z0-9_]* ;$' "$f" | tr -d ' ;' | sort -u); do
        # A machine script may define the function it ends by calling, in itself.
        grep -qE "^(function )?${fn}\(\)" "$f" && continue
        if ! (cd "$dir" && bash -c 'source "$1" >/dev/null 2>&1; declare -F "$2" >/dev/null' \
                _ "${WORKSPACE_SCRIPTS}/bootstrap.sh" "$fn") ; then
          err="calls ${fn}() but nothing defines it — is its file sourced in bootstrap-functions.sh?"
          break
        fi
      done
    fi

    # 3b. A builder that ends with build_distribution is installed by install_<distribution>_with_drush,
    #     which build_distribution calls by name. A builder copied from another family can keep that last
    #     line while its own family has no such function (the Website family installs in
    #     build_website_project): build_distribution exists, so check 3 passes, and the build stops at the install.
    if [ -z "$err" ] && grep -qE '^build_distribution ;$' "$f"; then
      dist=$(grep -oE '^distribution_name="[a-z0-9_]+"' "$f" | head -1 | cut -d'"' -f2)
      if [ -n "$dist" ] && ! grep -qE "^(function )?install_${dist}_with_drush ?\(\)" \
           "${WORKSPACE_SCRIPTS}/functions/fun-distribution-${dist}.sh" 2>/dev/null; then
        err="ends with build_distribution, but install_${dist}_with_drush() is not in fun-distribution-${dist}.sh"
      fi
    fi

    # 4. Builder scripts must have the human-readable name header.
    #    A builder is cmd-<distribution><version>-project.sh. cmd-tool-*/cmd-tools-* are the
    #    workspace's own tools — projects/cmd-tool-backup-project.sh ends in -project.sh too,
    #    and is not a builder.
    if [ -z "$err" ] && [[ "$(basename "$f")" == cmd-*-project.sh ]] \
       && [[ "$(basename "$f")" != cmd-tool-* ]] && [[ "$(basename "$f")" != cmd-tools-* ]] \
       && [[ "$(basename "$f")" != cmd-automated-testing-* ]] && [[ "$(basename "$f")" != cmd-bulk-* ]]; then
      if ! grep -q "^# workspace-name:" "$f"; then
        err="missing '# workspace-name:' header"
      fi
    fi

    if [ -z "$err" ]; then
      pass=$((pass+1))
      printf "PASS  %s\n" "$rel"
    else
      fail=$((fail+1))
      failures+=("$rel — $err")
      printf "FAIL  %s — %s\n" "$rel" "$err"
    fi
  done
done

echo
echo "=================================================="
echo " cmd- smoke test: ${pass} passed, ${fail} failed"
echo "=================================================="
for f in "${failures[@]}"; do echo " ✗ $f"; done
exit $fail
