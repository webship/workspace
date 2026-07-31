#!/bin/usr/env bash
# Smoke-test every cmd-*.sh in every workspace folder.
#
# For each script:
#  1. bash -n            — syntax check (always)
#  2. --help execution   — only for argparse-based scripts (safe: argparse
#                          prints usage and exits before any real work),
#                          which exercises bootstrap.sh, parse_yaml, the
#                          workspace + distribution configs and arg-*.sh
#  3. workspace-name     — builder scripts must carry the "# workspace-name:"
#                          header the dashboard shows in Build dropdowns
#
# Exit code: number of failing scripts (0 = all green).

# Find the workspace tooling from this script, so a fresh clone needs no setup.
WEBSHIP_WORKSPACE_SCRIPTS="${WEBSHIP_WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
source ${WEBSHIP_WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1

pass=0; fail=0; failures=()

for ws in "${workspaces[@]}"; do
  dir="${WEBSHIP_WORKSPACE_ROOT}/${ws}"
  [ -d "$dir" ] || continue
  for f in "$dir"/cmd-*.sh; do
    [ -f "$f" ] || continue
    rel="${ws}/$(basename "$f")"
    err=""

    # 1. Syntax
    if ! bash -n "$f" 2>/tmp/cmd-smoke-err; then
      err="syntax: $(head -1 /tmp/cmd-smoke-err)"
    fi

    # 2. argparse scripts: run --help (safe, exercises the full bootstrap chain)
    if [ -z "$err" ] && grep -q 'argparse "\$@"\|arg-${distribution_name}\|arg-\${distribution_name}' "$f"; then
      if ! (cd "$dir" && timeout 30 bash "$f" --help >/tmp/cmd-smoke-out 2>&1); then
        # argparse exits non-zero on --help in some versions; accept if usage was printed
        if ! grep -qi "usage" /tmp/cmd-smoke-out; then
          err="--help: $(tail -1 /tmp/cmd-smoke-out | cut -c1-120)"
        fi
      fi
    fi

    # 3. Builder scripts must have the human-readable name header.
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
