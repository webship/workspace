/**
 * The plugins a person can add, by family, with one line each.
 *
 * The core ships empty; this is what the empty dashboard suggests, what the Plugins page offers to
 * require, and what `webship-workspace catalog` prints. Every entry is an npm package
 * `@webship.co/workspace-<name>` (github.com/webship/workspace-<name>), turned on in four steps.
 */

const SCOPE = '@webship.co';

const FAMILIES = [
  { id: 'workspaces', label: 'Workspace folders', about: 'A folder of projects or items, with its settings file and its commands.', plugins: [
    ['dev', 'Development sites: the Drupal, Drupal CMS and Webship builders'], ['test', 'Test sites, with the automated-testing stack'],
    ['sandboxes', 'Throwaway experiments'], ['demos', 'Demo sites'], ['projects', 'Client projects'], ['products', 'Webship products'],
    ['drupal-site-templates', 'Drupal site templates'], ['drupal-modules', 'Contrib and private modules'], ['drupal-themes', 'Themes'], ['drupal-recipes', 'Recipes'], ['drupal-profiles', 'Installation profiles'],
    ['libraries', 'Third-party libraries'], ['docs', 'Markdown documents, edited in place'], ['specs', 'Specifications'], ['worklogs', 'Session worklogs'],
    ['images', 'Images'], ['video', 'Videos'], ['audio', 'Audio'], ['designs', 'Penpot designs'], ['avatar', 'Avatars and the talking assistant'],
    ['ai-agents', 'AI agents'], ['ai-skills', 'AI skills'], ['ai-commands', 'AI commands'], ['ai-prompts', 'AI prompts'],
    ['graph', 'Knowledge graphs of your projects, and the Graph menu'], ['rag', 'RAG indexes of your projects, and the RAG menu'],
  ] },
  { id: 'features', label: 'Features', about: 'A menu, a page or a service the core does not carry.', plugins: [
    ['git', 'The GIT menu on every project row'], ['ide', 'The Web IDE (VS Code in the browser) and the IDE menu'],
    ['jira', 'Jira work items, through the Teamwork Graph CLI'], ['google-drive', 'Sync a workspace folder to Google Drive, and its MCP server'],
    ['testing', 'The Tests menu and the test reports'], ['webship-js', 'Browser tests with webship-js'],
  ] },
  { id: 'hosting', label: 'Hosting providers', about: 'Link a project to its host: environments and live URLs, get the database and files, deploy, logs.', plugins: [
    ['upsun', 'Upsun'], ['acquia', 'Acquia Cloud'], ['digitalocean', 'DigitalOcean App Platform'], ['cpanel', 'cPanel'], ['aws', 'AWS Elastic Beanstalk'], ['azure', 'Azure App Service'], ['godaddy', 'GoDaddy'],
  ] },
  { id: 'forges', label: 'Git forges', about: 'The repository, its issues and pull requests, and the credential the dashboard uses there.', plugins: [
    ['github', 'GitHub'], ['gitlab', 'GitLab (git.drupalcode.org by default)'], ['bitbucket', 'Bitbucket'],
  ] },
  { id: 'containers', label: 'Container runtimes', about: 'A menu for projects that run on something other than DDEV.', plugins: [
    ['docker', 'Docker Compose'], ['lando', 'Lando'], ['docksal', 'Docksal'], ['podman', 'Podman'], ['kubernetes', 'Kubernetes'],
  ] },
  { id: 'platforms', label: 'Platforms', about: 'Builders and tools for one platform.', plugins: [
    ['drupal', 'Drupal'], ['wordpress', 'WordPress'], ['odoo', 'Odoo'],
  ] },
  { id: 'drives', label: 'Cloud drives', about: 'Push a folder to a cloud drive.', plugins: [
    ['microsoft', 'Microsoft OneDrive and SharePoint'], ['apple', 'Apple iCloud Drive'],
  ] },
];

/** Every catalogue entry, flat: { name, module, label, family }. */
function catalog() {
  const out = [];
  for (const f of FAMILIES) for (const [name, label] of f.plugins) out.push({ name, module: `${SCOPE}/workspace-${name}`, label, family: f.id, familyLabel: f.label });
  return out;
}

module.exports = { SCOPE, FAMILIES, catalog };
