#!/usr/bin/env bash

# The Vardot brand tokens come from the VDT Stylesheet in Figma. This keeps
# them current without ever leaving the dashboard unstyled:
#
#   fetch when possible  — a Figma personal access token in settings.yml
#                          (figma.token) or $FIGMA_TOKEN lets the REST API be
#                          read directly;
#   fall back to cache   — core/config/brand-tokens.json holds the last values
#                          actually fetched, with the date and the source node.
#
# Either way the run ends by writing the same :root block into the dashboard
# stylesheet, so a fetch failure changes nothing about how the app looks — it
# only means the values are as of the cached date.

BRAND_TOKENS_FILE="${WORKSPACE_CONFIG}/brand-tokens.json";
BRAND_STYLESHEET="${WORKSPACE_PATH}/workspace-app/public/style.css";

# The Figma token, if this machine has one. Never printed.
function brand_tokens_figma_token() {
  if [ -n "${FIGMA_TOKEN}" ]; then echo "${FIGMA_TOKEN}"; return 0 ; fi
  if [ -n "${figma_token}" ] && [ ! "${figma_token}" == 'CHANGE_ME' ]; then echo "${figma_token}"; return 0 ; fi
  return 1 ;
}

# Pull the brand colours out of the Figma file and update the cache.
# Returns 1 (quietly, with a reason) whenever it cannot — the caller then uses
# whatever the cache already holds.
function brand_tokens_fetch() {
  local token file_key node_ids response tmp;

  if ! command -v jq > /dev/null 2>&1 ; then
    echo "  jq is not installed — using the cached values." ;
    return 1 ;
  fi
  if ! token=$(brand_tokens_figma_token) ; then
    echo "  No Figma token on this machine — using the cached values." ;
    echo "  To fetch live: set figma.token in core/config/settings.yml (or export" ;
    echo "  FIGMA_TOKEN). Create one at figma.com > Settings > Personal access tokens." ;
    return 1 ;
  fi

  file_key=$(jq -r '.source.file' "${BRAND_TOKENS_FILE}") ;
  node_ids=$(jq -r '[.source.nodes[]] | join(",")' "${BRAND_TOKENS_FILE}") ;
  tmp=$(mktemp) ;

  # Nodes, not the variables endpoint: /v1/files/:key/variables/local is
  # Enterprise-only, while the colour rows in these frames are readable on any
  # plan. The token travels in a header, never on the command line.
  if ! curl -sS --max-time 30 -H @<(printf 'X-Figma-Token: %s\n' "${token}") \
      "https://api.figma.com/v1/files/${file_key}/nodes?ids=${node_ids}" > "${tmp}" 2>/dev/null ; then
    echo "  Could not reach the Figma API — using the cached values." ;
    rm -f "${tmp}" ; return 1 ;
  fi
  if jq -e '.err // .error' "${tmp}" > /dev/null 2>&1 ; then
    echo "  Figma rejected the request ($(jq -r '.err // .error' "${tmp}")) — using the cached values." ;
    rm -f "${tmp}" ; return 1 ;
  fi

  # Each colour row carries its variable name and a solid fill. Pair them up.
  local fetched;
  fetched=$(jq -c '
    [ .nodes[]?.document
      | .. | objects
      | select(.name? != null and (.name | test("^(brand|subtle)/")))
      | { key: (.name | sub("/"; "-")),
          fill: ( [.. | objects | select(.type? == "SOLID") | .color ] | first ) }
      | select(.fill != null)
      | { (.key): ( "#" +
          ((.fill.r * 255 | round) | tostring | tonumber | . as $v | ($v + 256) | tostring | .[1:] ) ) } ]
    | add // {}' "${tmp}" 2>/dev/null) ;

  if [ -z "${fetched}" ] || [ "${fetched}" == '{}' ] || [ "${fetched}" == 'null' ] ; then
    echo "  Fetched the file but found no brand/* colour rows — the frame may have" ;
    echo "  been restructured. Using the cached values; re-check the node ids in" ;
    echo "  ${BRAND_TOKENS_FILE}." ;
    rm -f "${tmp}" ; return 1 ;
  fi

  jq --argjson new "${fetched}" --arg today "$(date '+%Y-%m-%d')" \
    '.tokens = (.tokens * $new) | .fetched_at = $today | .fetched_by = "figma-api"' \
    "${BRAND_TOKENS_FILE}" > "${tmp}.out" && mv "${tmp}.out" "${BRAND_TOKENS_FILE}" ;
  rm -f "${tmp}" ;
  echo "  Fetched from Figma and updated the cache." ;
}

# Write the cached tokens into the dashboard stylesheet's :root block.
function brand_tokens_apply() {
  local generated;
  if ! command -v jq > /dev/null 2>&1 ; then
    echo "  jq is not installed — cannot rewrite the stylesheet." ;
    return 1 ;
  fi
  generated=$(jq -r '
    "  /* Brand */",
    "  --brand-primary: \(.tokens["brand-primary"]);",
    "  --brand-secondary: \(.tokens["brand-secondary"]);",
    "  --brand-accent: \(.tokens["brand-accent"]);",
    "  --brand-dark: \(.tokens["brand-dark"]);",
    "  --brand-light: \(.tokens["brand-light"]);",
    "  /* Subtle (tinted surfaces) */",
    "  --subtle-light: \(.tokens["subtle-light"]);",
    "  --subtle-brand: \(.tokens["subtle-brand"]);",
    "  --subtle-accent: \(.tokens["subtle-accent"]);"' "${BRAND_TOKENS_FILE}") ;

  python3 - "${BRAND_STYLESHEET}" <<PYEOF || return 1
import re, sys
path = sys.argv[1]
generated = """${generated}"""
css = open(path).read()
start = css.index(':root {')
end = css.index('}', start)
block = css[start:end]
# Replace only the generated brand/subtle lines; hand-written aliases below stay.
head, sep, tail = block.partition('  /* What the dashboard paints with')
if not sep:
    print('  :root block is not in the expected shape — not touching it.')
    sys.exit(1)
open(path, 'w').write(css[:start] + ':root {\n' + generated + '\n\n' + sep + tail + css[end:])
print('  Stylesheet :root updated.')
PYEOF
}

# The whole job: try Figma, fall back to the cache, apply either way.
function brand_tokens_sync() {
  echo "*---------------------------------------------------------------------*";
  echo "  Vardot brand tokens";
  echo "*---------------------------------------------------------------------*";
  echo "  source: $(jq -r '.source.name + " (" + .source.url + ")"' "${BRAND_TOKENS_FILE}" 2>/dev/null)";

  if [ "${CACHED}" == 'yes' ] ; then
    echo "  --cached: skipping the fetch by request." ;
  else
    brand_tokens_fetch || true ;
  fi

  echo "  values as of: $(jq -r '.fetched_at + " (" + .fetched_by + ")"' "${BRAND_TOKENS_FILE}" 2>/dev/null)";
  if [ "${SHOW}" == 'yes' ] ; then
    jq -r '.tokens | to_entries[] | "    \(.key): \(.value)"' "${BRAND_TOKENS_FILE}" ;
  fi

  if [ ! "${NO_APPLY}" == 'yes' ] ; then
    brand_tokens_apply ;
    echo "  Restart the dashboard app to serve it:" ;
    echo "    docker exec ddev-workspace-web sh -c 'pkill -f \"node server.js\"'" ;
  fi
}
