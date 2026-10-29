/**
 * Walking a documents folder, not just the top of it.
 *
 * `docs/` holds 29 folders and eight thousand files; the listing showed 21 rows. Everything in a
 * subfolder was invisible, and so was every file whose extension was not on a curated list — a
 * screenshot, a recording, a zip of a client's exports. The folder on disk and the page describing it
 * disagreed, which is the one thing a file listing must not do.
 *
 * So: folders are rows you open, at any depth, and anything in the folder is listed. Three rules keep
 * that honest and bounded:
 *
 *   - **One level at a time.** A folder row says how many entries are inside and opens into them. The
 *     alternative — every file in the tree on one page — is 8,105 rows here, which is not a listing.
 *   - **A path is checked, never trusted.** Every subfolder arrives from the browser, so it is split
 *     into segments, refused if any is `..`, resolved with realpath and refused again if the result
 *     left the workspace. A symlink out of the tree is the case the segment check alone misses.
 *   - **Noise is named, not guessed at.** The workspace's own plumbing (`cmd-*.sh`, the
 *     `*.code-workspace`, `README`/`AGENTS`/`CLAUDE`) and the directories nobody browses
 *     (`node_modules`, the `dev-ai-agents` checkout, dotfiles) are excluded by name. Everything else is
 *     shown, whatever its extension — the point of the change is that nothing in the folder hides.
 */

const fs = require('fs');
const path = require('path');

const { workspaceDir } = require('./workspaces');

// Which workspaces browse their folders: the ones that hold files a person put in a folder.
//
// Not the `ai-*` ones — they list items by the name declared in their frontmatter, and a subdirectory
// there is a skill they already handle, so folders would be a second, competing idea of what a row is.
//
// `videos` is here too, and the rule that kept it out is kept rather than dropped: a poster frame is
// an input to the player, not something to browse, and listing it doubled the rows and made half of
// them stills. It is now attached to its recording as the THUMBNAIL (see `attachPosters`), which is
// what a poster was always for.
// `specs` is browsable for the same reason docs is, and it is the one that most needs it: a spec is
// a FOLDER (products/<project>/NNN-topic/ holding four files, or products/<project>/ holding the
// product's constitution), so a flat read of the top level found nothing at all and the page said
// "No specs here yet" on a workspace with twelve of them.
const BROWSABLE = new Set(['docs', 'designs', 'images', 'videos', 'audio', 'specs']);

/** Is this the still that belongs to a recording, rather than a picture in its own right? */
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)$/i;

/**
 * Give each recording its poster, and take the poster off the list.
 *
 * Two shapes, both of which the recorder writes: `demo.mp4` beside `demo-poster.jpg`, and `demo.mp4`
 * beside `demo.jpg` — the second already groups into the same row, so it only has to be told that the
 * picture is the poster rather than a second format to offer a button for.
 *
 * Mutates and returns the groups map, because it is the same pass that built it.
 */
function attachPosters(groups) {
  for (const [stem, g] of groups) {
    if (!g.formats.some((f) => f.video)) continue;
    // The picture sharing the recording's name: its poster, not a format of it.
    const inline = g.formats.find((f) => IMAGE_RE.test(f.file));
    if (inline) {
      g.poster = inline.path || inline.file;
      g.formats = g.formats.filter((f) => f !== inline);
    }
    // And the `-poster` one, which readdir gave a row of its own.
    const sidecar = groups.get(`${stem}-poster`);
    if (sidecar && sidecar.formats.every((f) => IMAGE_RE.test(f.file))) {
      g.poster = g.poster || (sidecar.formats[0].path || sidecar.formats[0].file);
      groups.delete(`${stem}-poster`);
    }
  }
  return groups;
}

const TEXT_RE = /\.(txt|md)$/i;
const SOUND_SIDECARS = ['-cover', '-poster', '-transcript', '-script', '-voiceover-script'];

/**
 * The audio workspace lists SOUNDS and what belongs to them, the way videos lists recordings.
 *
 * A sound's belongings are its cover picture, the text it was made from (or spoken), and the record of
 * how it was made. They sit beside it as `<name>.jpg`, `<name>.txt`, `<name>.json` (or `<name>-cover.jpg`,
 * `<name>-transcript.md`), and they are part of its row, not rows of their own. A file that is neither a
 * sound nor the belonging of one is not listed: this folder is for audio.
 */
function attachSoundBelongings(groups) {
  const sounds = [...groups].filter(([, g]) => g.formats.some((f) => f.audio));
  for (const [stem, g] of sounds) {
    const own = g.formats.filter((f) => !f.audio);
    const take = (f) => {
      const at = f.path || f.file;
      if (IMAGE_RE.test(f.file)) g.poster = g.poster || at;
      else if (TEXT_RE.test(f.file)) g.transcript = g.transcript || at;
      else if (/\.json$/i.test(f.file)) g.record = g.record || at;
      else return false;
      return true;
    };
    for (const f of own) take(f);
    for (const suffix of SOUND_SIDECARS) {
      const side = groups.get(`${stem}${suffix}`);
      if (side && side.formats.every((f) => !f.audio) && side.formats.some((f) => take(f))) groups.delete(`${stem}${suffix}`);
    }
    g.formats = g.formats.filter((f) => f.audio);
    g.size = g.formats.reduce((n, f) => n + f.size, 0);
  }
  for (const [stem, g] of [...groups]) if (!g.formats.some((f) => f.audio)) groups.delete(stem);
  return groups;
}

// Directories nobody browses: an installed dependency tree, the gitignored mirror of the shared
// agents repository, and anything hidden.
const NOISE_DIRS = new Set(['node_modules', 'dev-ai-agents', 'workspace-repo', '.git']);

// The workspace's own plumbing, which is tooling rather than content: the builders, the editor's
// project file, and the three documents about the folder (which the page already renders on its own,
// under the list).
const NOISE_FILES = /^(cmd-.*\.sh|.*\.code-workspace|README\.md|AGENTS\.md|CLAUDE\.md)$/i;

const isNoise = (name, isDir) => name.startsWith('.')
  || (isDir ? NOISE_DIRS.has(name) : NOISE_FILES.test(name));

/**
 * The folder a request names, or an error saying why not.
 *
 * `rel` is what the page puts in its links and `abs` is what it reads. Both are derived here, so no
 * caller builds a path out of a browser value itself.
 */
function safeSub(key, sub) {
  return safeSubIn(workspaceDir(key), sub);
}

/**
 * The same check against a root given directly, which is what makes it testable: a fixture with a
 * symlink pointing out of the tree can be built in a temp directory, and the rule that matters — a
 * link out is refused even though every segment was innocent — is then actually exercised.
 */
function safeSubIn(root, sub) {
  if (!root) return { ok: false, error: 'Unknown workspace.' };
  const raw = String(sub || '').replace(/^\/+|\/+$/g, '');
  if (!raw) return { ok: true, rel: '', abs: root, root };
  if (raw.includes('\0')) return { ok: false, error: 'Bad path.' };
  const segs = raw.split('/');
  // `.` and `..` never reach the filesystem, and neither does an empty segment (`a//b`).
  if (segs.some((s) => !s || s === '.' || s === '..')) return { ok: false, error: 'Bad path.' };
  const abs = path.join(root, ...segs);
  let real;
  let realRoot;
  try {
    real = fs.realpathSync(abs);
    realRoot = fs.realpathSync(root);
  } catch (_) {
    return { ok: false, error: 'No such folder.' };
  }
  // The check the segments cannot make: a symlink inside the workspace pointing out of it.
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return { ok: false, error: 'Bad path.' };
  try {
    if (!fs.statSync(real).isDirectory()) return { ok: false, error: 'Not a folder.' };
  } catch (_) {
    return { ok: false, error: 'No such folder.' };
  }
  return { ok: true, rel: segs.join('/'), abs: real, root };
}

/**
 * The real path of a file inside a workspace, or '' when it is not one. Containment is judged against
 * the workspace's OWN real path, so a workspace that is itself a symlink onto a second disk serves its
 * files, while a link from inside it to anywhere else is still refused.
 */
function realFileIn(root, rel) {
  try {
    const real = fs.realpathSync(path.join(root, rel));
    const base = fs.realpathSync(root);
    if (real !== base && !real.startsWith(base + path.sep)) return '';
    return fs.statSync(real).isFile() ? real : '';
  } catch (_) {
    return '';
  }
}

/**
 * The subfolders of one directory, each with what is inside it.
 *
 * The count is of DIRECT entries, not of the whole subtree: one `readdir` per folder is cheap and
 * true, while a recursive count of `screenshots/` would walk thousands of files to render one row —
 * and "12 items" is what tells you whether opening it is worth it anyway.
 */
function subfolders(abs, rel) {
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (_) {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && !isNoise(e.name, true))
    .map((e) => {
      const full = path.join(abs, e.name);
      let count = 0;
      let folders = 0;
      try {
        for (const c of fs.readdirSync(full, { withFileTypes: true })) {
          if (isNoise(c.name, c.isDirectory())) continue;
          count += 1;
          if (c.isDirectory()) folders += 1;
        }
      } catch (_) { /* unreadable: it is still a folder, it just says nothing */ }
      let mtime = new Date(0);
      try { mtime = fs.statSync(full).mtime; } catch (_) { /* keep the epoch */ }
      return {
        folder: true,
        name: e.name,
        rel: rel ? `${rel}/${e.name}` : e.name,
        count,
        folders,
        mtime,
      };
    });
}

/** The trail back out: `[{ name, rel }]`, the workspace itself first, the current folder last. */
function crumbs(key, rel, rootLabel) {
  const trail = [{ name: rootLabel || key, rel: '' }];
  if (!rel) return trail;
  const segs = rel.split('/');
  segs.forEach((s, i) => trail.push({ name: s, rel: segs.slice(0, i + 1).join('/') }));
  return trail;
}

// What a file looks like in a list, by extension. A kind, not a format: a row should say "this is a
// picture" at a glance, and the format is already written on its buttons.
const KIND_ICONS = [
  [/\.(pdf)$/i, 'tabler:file-type-pdf'],
  [/\.(docx?|odt|rtf)$/i, 'tabler:file-type-doc'],
  [/\.(xlsx?|ods|csv)$/i, 'tabler:table'],
  [/\.(pptx?|odp)$/i, 'tabler:presentation'],
  [/\.(html?|xml)$/i, 'tabler:world'],
  [/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)$/i, 'tabler:photo'],
  [/\.(mp4|m4v|webm|ogv|mov|avi|mkv)$/i, 'tabler:player-play'],
  [/\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba)$/i, 'tabler:music'],
  [/\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$/i, 'tabler:file-zip'],
  [/\.(md|markdown|txt|log)$/i, 'tabler:file-text'],
  [/\.(json|ya?ml|toml|ini|conf)$/i, 'tabler:code'],
  [/\.(js|ts|jsx|tsx|css|scss|php|py|rb|sh|bash)$/i, 'tabler:code'],
];

const kindIcon = (name) => (KIND_ICONS.find(([re]) => re.test(name)) || [null, 'tabler:file'])[1];

module.exports = { BROWSABLE, isNoise, safeSub, safeSubIn, realFileIn, subfolders, crumbs, kindIcon, attachPosters, attachSoundBelongings, IMAGE_RE, NOISE_FILES, NOISE_DIRS };
