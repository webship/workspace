/**
 * Workspace types: what a folder's projects are FOR, and therefore which actions
 * their rows offer.
 *
 * Two layers decide whether a control appears, and they answer different questions:
 *
 *   capability  does this folder ship the script?   (findBackupScript, cmd-tools-testing.sh …)
 *   policy      does this KIND of folder want it?   (this file)
 *
 * Discovery alone was the whole story until now, which meant a folder got every
 * control its scripts could serve — a code-packages folder with a backup script
 * showed DDEV/Upsun surface the moment someone copied the wrong cmd file in.
 * The type is chosen per workspace in workspace.<name>.settings.yml (`type:`),
 * editable from the Settings page; these defaults cover the shipped folders so
 * an unset file behaves exactly as it always did.
 *
 * `kind` (projects/files page layout) is presentation and stays in
 * workspaces.js — a type never changes how a page is laid out, only which
 * actions its project rows carry.
 */

/** One workspace type: its label in Settings, what it is for, and the actions its project rows carry. */
export interface WorkspaceType { label: string; description: string; actions: string[] }

export const TYPES: Record<string, WorkspaceType> = {
  sites: {
    label: 'Sites — DDEV projects',
    description: 'Built Drupal sites: DDEV controls, tests, users, the full toolbelt.',
    actions: ['build', 'folder', 'ddev', 'backup', 'clone', 'remove', 'ragify', 'tests', 'checks', 'users'],
  },
  code: {
    label: 'Code — packages and repositories',
    description: 'Modules, themes, libraries, recipes: quality checks and knowledge tools, no site controls.',
    actions: ['build', 'folder', 'backup', 'remove', 'ragify', 'checks'],
  },
  files: {
    label: 'Files — documents and drafts',
    description: 'Markdown and documents; the page is an item list, projects carry no actions.',
    actions: ['folder'],
  },
  media: {
    label: 'Media — recordings',
    description: 'Videos and other media; the page is an item list, projects carry no actions.',
    actions: ['folder'],
  },
  'ai-items': {
    label: 'AI items — agents, skills, prompts',
    description: 'Claude Code items with their own install/fetch/propose surface.',
    actions: [],
  },
};

// What each shipped folder is, so nothing changes until somebody edits a `type:`.
// A folder absent here (a new workspace) defaults by its kind: projects → sites.
export const DEFAULT_TYPE_BY_KEY: Record<string, string> = {
  products: 'sites', dev: 'sites', test: 'sites', demos: 'sites', sandboxes: 'sites',
  projects: 'sites', profiles: 'sites', 'site-templates': 'sites', rag: 'sites', designs: 'sites',
  recipes: 'code', components: 'code', themes: 'code', modules: 'code', libraries: 'code',
  forked: 'code', graphs: 'code',
  docs: 'files', worklogs: 'files', specs: 'files',
  images: 'media', videos: 'media', audio: 'media',
  'ai-agents': 'ai-items', 'ai-skills': 'ai-items',
  'ai-commands': 'ai-items', 'ai-prompts': 'ai-items',
};

export function isType(name: unknown): name is string {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(TYPES, name);
}

/** The type a workspace resolves to: its own `type:`, the shipped default, or by kind. */
export function resolveType(key: string, declaredType?: string | null, kind?: string): string {
  if (declaredType && isType(declaredType)) return declaredType;
  if (DEFAULT_TYPE_BY_KEY[key]) return DEFAULT_TYPE_BY_KEY[key];
  return kind === 'files' ? 'files' : 'sites';
}

export function typeActions(type: string): Set<string> {
  return new Set((TYPES[type] ?? TYPES.sites)?.actions);
}

/** An action a plugin brings ('upsun' on sites): allowed on the types it names from now on. */
export function addTypeAction(action: string, types?: readonly string[] | null): void {
  for (const type of types || []) {
    const t = TYPES[type];
    if (t && !t.actions.includes(action)) t.actions.push(action);
  }
}
