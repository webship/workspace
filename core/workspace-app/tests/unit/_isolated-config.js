/**
 * A copy of the workspace config for a test to run against, with the ElevenLabs settings put back to the
 * shipped placeholders. A machine's own settings.yml holds its real key, voice and model, and a test that
 * reads them passes on a clean clone and fails on the machine that uses the feature.
 */

const fs = require('fs');
const path = require('path');

const PLACEHOLDERS = 'elevenlabs:\n  api_key: CHANGE_ME\n  voice_id: ask\n  model_id: eleven_v4\n  region: global\n';

/** The settings text without its top-level `elevenlabs:` block, whatever keys that block holds. */
function withoutElevenlabs(text) {
  const out = [];
  let skipping = false;
  for (const line of text.split('\n')) {
    if (/^elevenlabs:\s*(#.*)?$/.test(line)) { skipping = true; continue; }
    if (skipping && /^(\s+\S|\s*$)/.test(line)) continue;          // the block's own lines, and blanks inside it
    skipping = false;
    out.push(line);
  }
  return out.join('\n');
}

function copyConfig(from, to) {
  fs.cpSync(from, to, { recursive: true });
  const file = path.join(to, 'settings.yml');
  fs.writeFileSync(file, `${withoutElevenlabs(fs.readFileSync(file, 'utf8')).replace(/\s*$/, '\n')}\n${PLACEHOLDERS}`);
}

module.exports = { copyConfig, withoutElevenlabs, PLACEHOLDERS };
