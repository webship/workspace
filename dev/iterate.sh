#!/bin/bash
# Usage: ./iterate.sh <alphaN>   (e.g. ./iterate.sh 29)
# Bumps display_builder_ai + display_builder_base to 1.0.0-alphaN, rezips both,
# rebuilds manual HTML+PDF at that version, redeploys to drupal11test1, cache-rebuilds.

set -e
N="$1"
[ -z "$N" ] && { echo "need alpha N"; exit 1; }
VER="1.0.0-alpha${N}"
SLUG="1-0-0-alpha${N}"
PREV_VER=$(grep -oE "1\.0\.0-alpha[0-9]+" sobki_profile_bootstrap/web/modules/custom/display_builder_ai/display_builder_ai.info.yml | head -1)
PREV_SLUG=$(echo "$PREV_VER" | tr '.' '-')

cd /home/rajab/workspace/dev

# 1. Bump module info.yml + recipe composer.json.
sed -i "s/version: '${PREV_VER}'/version: '${VER}'/" sobki_profile_bootstrap/web/modules/custom/display_builder_ai/display_builder_ai.info.yml
# Bump recipe — independently from whatever it was last at.
RECIPE_PREV=$(grep -oE '"version": "1\.0\.0-alpha[0-9]+"' display_builder_base/composer.json | head -1 | sed 's/"version": "//;s/"//')
[ -z "$RECIPE_PREV" ] && RECIPE_PREV=$(grep -oE '"version": "[^"]+"' display_builder_base/composer.json | head -1 | sed 's/"version": "//;s/"//')
sed -i "s/\"version\": \"${RECIPE_PREV}\"/\"version\": \"${VER}\"/" display_builder_base/composer.json

# 2. Rezip both.
(cd sobki_profile_bootstrap/web/modules/custom && zip -qr /home/rajab/workspace/dev/display_builder_ai-${SLUG}.zip display_builder_ai -x '*.git*' '*.DS_Store')
zip -qr display_builder_base-${SLUG}.zip display_builder_base -x '*.git*' '*.DS_Store'

# 3. Rebuild manual at new version (content unchanged, just version bump).
python3 -c "
src = open('display_builder_ai-manual-${PREV_SLUG}.html').read()
out = src.replace('${PREV_VER}', '${VER}').replace('${PREV_SLUG}', '${SLUG}')
assert '—' not in out
open('display_builder_ai-manual-${SLUG}.html','w').write(out)
" 2>/dev/null || python3 -c "
import os
srcs = sorted([f for f in os.listdir('.') if f.startswith('display_builder_ai-manual-1-0-0-alpha') and f.endswith('.html')])
src = srcs[-1] if srcs else 'display_builder_ai-manual-1-0-0-alpha28.html'
content = open(src).read()
import re
content = re.sub(r'1\.0\.0-alpha\d+', '${VER}', content)
content = re.sub(r'1-0-0-alpha\d+', '${SLUG}', content)
open('display_builder_ai-manual-${SLUG}.html','w').write(content)
"
google-chrome --headless --no-sandbox --disable-gpu --no-pdf-header-footer --print-to-pdf=display_builder_ai-manual-${SLUG}.pdf "file://$(pwd)/display_builder_ai-manual-${SLUG}.html" >/dev/null 2>&1

# 4. Deploy to drupal11test1.
cd drupal11test1
rm -rf web/modules/custom/display_builder_ai
unzip -q /home/rajab/workspace/dev/display_builder_ai-${SLUG}.zip -d web/modules/custom/
ddev drush cr >/dev/null 2>&1

echo "round ${N}: deployed ${VER}; artifacts: display_builder_ai-${SLUG}.zip, display_builder_base-${SLUG}.zip, manual-${SLUG}.{html,pdf}"
