/**
 * The platform of a project that is not Drupal, read from its DDEV project type.
 *
 * The core's tools were written for Drupal; a plugin for another platform (WordPress, TYPO3, …)
 * carries that platform's user list and CLI under the name DDEV gives the project type
 * (`set_wordpress_users`, `add_wordpress_users`). This is the one place the dashboard reads that
 * name, so a row's Users menu hands `cmd-tools-add-users.sh` the right list.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * The project type and docroot a project declares: `type:` and `docroot:` of its `.ddev/config.yaml`, or, on
 * another runtime (Docker Compose, Podman, Kubernetes), of the `x-webship:` block of its `compose.yaml`
 * (project-runtime.js). Null for a folder that carries neither.
 */
function declaredOf(projectDir) {
  try {
    const config = fs.readFileSync(path.join(projectDir, '.ddev', 'config.yaml'), 'utf8');
    return { type: (config.match(/^type:\s*["']?([a-z0-9_-]+)["']?\s*$/m) || [])[1] || '',
      docroot: (config.match(/^docroot:\s*"?([^"\n]*)"?/m) || [])[1] || '' };
  } catch (_) { /* not a DDEV project */ }
  const on = require('./project-runtime').readProject(projectDir);
  if (!require('./project-runtime').isRuntimeProject(on)) return null;
  return { type: /^[a-z0-9_-]+$/.test(on.type) ? on.type : '', docroot: /^[\w./-]*$/.test(on.docroot) ? on.docroot : '' };
}

// Types that say nothing about the platform, and Drupal's own (the profile decides there).
const NOT_A_PLATFORM = /^(drupal\d*|php|generic|)$/;

/** `wordpress`, `typo3`, `magento2`… — or '' for a Drupal project, a bare PHP one, or no DDEV project. */
function platformOfProject(projectDir) {
  const declared = declaredOf(projectDir);
  if (!declared) return '';
  const { type } = declared;
  // The name becomes part of a bash function name.
  return NOT_A_PLATFORM.test(type) ? '' : type.replace(/-/g, '_');
}

/**
 * The user list of a Drupal project that has no install profile of a distribution under
 * `profiles/contrib`: `drupal_cms` when its composer.json carries the Drupal CMS packages,
 * `drupal` otherwise. '' for a project whose DDEV project type is not Drupal's.
 *
 * Without this the Users menu handed such a project the list of the Webship distribution, and the
 * lists of Drupal core and Drupal CMS (the tooling's, or a platform plugin's) were never reached.
 */
function drupalBaseOfProject(projectDir) {
  const declared = declaredOf(projectDir);
  if (!declared) return '';
  const { type } = declared;
  if (!/^drupal\d*$/.test(type)) return '';
  let composer = '';
  try { composer = fs.readFileSync(path.join(projectDir, 'composer.json'), 'utf8'); } catch (_) { /* a project with no composer.json is a plain one */ }
  return /"drupal\/(cms|drupal_cms_[a-z0-9_]+)"/.test(composer) ? 'drupal_cms' : 'drupal';
}

/**
 * The names of the user lists the tooling can load here: `set_<name>_users` in the core's functions and in every
 * installed plugin's (core/scripts/plugins/<plugin>/functions/). Read again at most every few seconds: a menu
 * asks for every row.
 */
let listsSeen = { at: 0, root: '', names: new Set() };
function userListNames(root) {
  if (listsSeen.root === root && Date.now() - listsSeen.at < 5000) return listsSeen.names;
  const names = new Set();
  const scripts = path.join(root, 'core', 'scripts');
  const dirs = [path.join(scripts, 'functions')];
  try {
    for (const p of fs.readdirSync(path.join(scripts, 'plugins'))) dirs.push(path.join(scripts, 'plugins', p, 'functions'));
  } catch (_) { /* no plugin placed functions here */ }
  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.sh')); } catch (_) { continue; }
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch (_) { continue; }
      for (const m of text.matchAll(/^[ \t]*(?:function[ \t]+)?set_([a-z0-9_]+)_users[ \t]*(?:\(\))?[ \t]*\{?/gm)) names.add(m[1]);
    }
  }
  listsSeen = { at: Date.now(), root, names };
  return names;
}

/**
 * The platform plugin that claims a project: a plugin that builds apps on a DDEV type of no platform (php,
 * generic) or of another one (a shop on wordpress) writes `.ddev/config.<plugin>.yaml` in it. On another runtime
 * (Docker Compose, Podman, Kubernetes) the claim is `platform: <plugin>` in the `x-webship:` block of its
 * `compose.yaml`, written by `rt_claim` (fun-runtime.sh). When that plugin carries a user list (`names`), the
 * project takes that list (#490).
 */
function claimOfProject(projectDir, names) {
  let entries = null;
  try { entries = fs.readdirSync(path.join(projectDir, '.ddev')); } catch (_) { /* not a DDEV project */ }
  if (entries) {
    for (const e of entries.sort()) {
      const m = e.match(/^config\.([a-z0-9][a-z0-9-]*)\.ya?ml$/);
      const name = m && m[1].replace(/-/g, '_');
      if (name && names.has(name)) return name;
    }
    // A DDEV project is DDEV's (rt_find_project decides the same way): its compose.yaml, if any, is not asked.
    if (entries.includes('config.yaml')) return '';
  }
  const on = require('./project-runtime').readProject(projectDir);
  if (!require('./project-runtime').isRuntimeProject(on)) return '';
  const name = /^[a-z0-9][a-z0-9_-]*$/.test(on.platform) ? on.platform.replace(/-/g, '_') : '';
  return name && names.has(name) ? name : '';
}

/**
 * The user list a project's Users verbs hand `cmd-tools-add-users.sh`, or '' when it has none.
 *
 * In this order: the distribution its install profile names (`profile`, read by the caller), the plugin that
 * claims it, the platform its DDEV type names, Drupal core or Drupal CMS for a Drupal project. A project of any
 * other type that no plugin claims has no list: it used to get the Webship distribution's, which runs drush, on
 * a CodeIgniter app or a Node one (#490).
 */
function userListOfProject(projectDir, { root, profile = '' } = {}) {
  if (profile) return profile;
  const names = userListNames(root);
  return claimOfProject(projectDir, names) || platformOfProject(projectDir) || drupalBaseOfProject(projectDir);
}

/** The install profile under <docroot>/profiles/contrib that names a Drupal project's distribution, or ''. */
function profileOfProject(projectDir) {
  try {
    const declared = declaredOf(projectDir);
    if (!declared) return '';
    const doc = declared.docroot || 'web';
    const info = fs.readdirSync(path.join(projectDir, doc, 'profiles', 'contrib'));
    return info.find((n) => n === 'webship') || info[0] || '';
  } catch (_) { return ''; }
}

module.exports = { declaredOf, platformOfProject, drupalBaseOfProject, userListNames, claimOfProject, userListOfProject, profileOfProject };
