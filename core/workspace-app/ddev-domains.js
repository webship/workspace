/**
 * The addresses a DDEV project answers at, beside the one its NAME gives it.
 *
 * DDEV has two keys for this and they are not interchangeable:
 *
 *   additional_hostnames:  LABELS   — `project_tld` is appended to each
 *   additional_fqdns:      HOSTNAMES — nothing is appended
 *
 * The dashboard read only the first for a long time, which is why a project with a Storybook showed
 * no extra domains at all: Webship writes `storybook.<project>.ddev.site` into `additional_fqdns`,
 * because it is a whole hostname and putting it in the label list would give
 * `storybook.<project>.ddev.site.ddev.site`.
 *
 * Kept in its own module so it can be tested. The parsing is the part that was wrong, and it is the
 * part nothing could reach while it lived inside the request handler.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Strip one layer of quotes from a YAML scalar. */
const unquote = (s) => String(s).trim().replace(/^["']|["']$/g, '');

/**
 * The raw keys, kept apart.
 *
 * `list` is what the hostname-collision check compares, and it compares labels — so a full hostname
 * must never be folded into it, or it would compare `blog2` against `storybook.x.ddev.site`.
 */
function ddevHostnames(dir) {
  const out = { list: [], fqdns: [], tld: 'ddev.site' };
  let cfg;
  try {
    cfg = fs.readFileSync(path.join(dir, '.ddev', 'config.yaml'), 'utf8').split('\n');
  } catch (_) {
    return out;                       // not a DDEV project
  }
  let into = null;
  for (const ln of cfg) {
    // A comment is not configuration. A stock config.yaml ships `# additional_hostnames:` and
    // `#  - somename`, and a parser that reads those hands every project hostnames it never had.
    if (/^\s*#/.test(ln)) continue;

    const head = ln.match(/^(additional_hostnames|additional_fqdns):(.*)$/);
    if (head) {
      const target = head[1] === 'additional_fqdns' ? out.fqdns : out.list;
      const rest = head[2].trim();
      if (rest.startsWith('[')) {
        target.push(...rest.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean));
      } else {
        into = target;                // a block list follows
      }
      continue;
    }
    if (into) {
      const item = ln.match(/^\s+-\s*(.+?)\s*$/);
      if (item) { into.push(unquote(item[1])); continue; }
      if (ln.trim() === '' || /^\s/.test(ln)) continue;
      into = null;
    }
    const tld = ln.match(/^project_tld:\s*"?([^"#\s]+)"?\s*$/);
    if (tld) out.tld = tld[1];
  }
  return out;
}

/**
 * Every extra address, as whole hostnames, with the Storybook one marked.
 *
 * Storybook is marked because it is not another copy of the site: it is the component library, a
 * different thing to open, and the address people go looking for and cannot find.
 */
function ddevExtraDomains(dir) {
  const { list, fqdns, tld } = ddevHostnames(dir);
  const hosts = [...list.map((label) => `${label}.${tld}`), ...fqdns];
  const seen = new Set();
  return hosts
    .filter((h) => h && !seen.has(h) && seen.add(h))
    .map((host) => ({ host, storybook: /^storybook\./i.test(host) }));
}

module.exports = { ddevHostnames, ddevExtraDomains };
