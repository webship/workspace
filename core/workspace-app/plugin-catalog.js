/**
 * The plugins a person can add, by family, with one line each.
 *
 * The core ships empty; this is what the empty dashboard suggests, what the Plugins page offers to
 * require, and what `webship-workspace catalog` prints. Every entry is an npm package
 * `@webship.co/workspace-<name>` (github.com/webship/workspace-<name>), turned on in four steps.
 *
 * Only what is published goes here: an entry is an offer, and `plugin require <name>` must be able to
 * fetch it. A plugin that is planned but not on npm yet is added the day its first version is.
 */

const SCOPE = '@webship.co';

// Each plugin: [id, name, what it is in a line]. The name is the one Settings shows everywhere; the
// line is what a person reads to decide, so it says what the plugin does, never its package name.
const FAMILIES = [
  { id: 'platforms', label: 'Platforms', about: 'Builders and tools for one platform.', plugins: [
    ['drupal', 'Drupal', 'A builder for Drupal core sites and the Drush tool'],
    ['drupal-cms', 'Drupal CMS', 'A builder for Drupal CMS sites, with site templates and recipes'],
    ['wordpress', 'WordPress', 'A builder for WordPress sites and the WP-CLI tool'],
    ['joomla', 'Joomla', 'A builder for Joomla sites and the Joomla CLI tool'],
    ['typo3', 'TYPO3', 'A builder for TYPO3 sites and its console tool'],
    ['backdrop-cms', 'Backdrop CMS', 'A builder for Backdrop CMS sites and its command line tool'],
    ['craft-cms', 'Craft CMS', 'A builder for Craft CMS sites and its console tool'],
    ['django-cms', 'django CMS', 'A builder for django CMS sites and its manage tool'],
    ['ghost', 'Ghost', 'A builder for Ghost sites and the Ghost CLI tool'],
    ['magento', 'Magento', 'A builder for Magento shops and its command line tool'],
    ['prestashop', 'PrestaShop', 'A builder for PrestaShop shops and its console tool'],
    ['odoo', 'Odoo', 'A builder for Odoo Community sites and the odoo-bin tool'],
    ['astro', 'Astro', 'A builder for Astro sites'],
    ['gatsby', 'Gatsby', 'A builder for Gatsby sites'],
    ['laravel', 'Laravel', 'A builder for Laravel apps from the official starter kits, and the artisan tool'],
    ['filament', 'Filament', 'A builder for Filament admin panels on Laravel apps, new or the official demo'],
    ['keycloak', 'Keycloak', 'A builder for Keycloak sign-in test sites (server, realm, app, mail catcher), and the admin tool'],
    ['symfony', 'Symfony', 'A builder for Symfony apps, and the Symfony console tool'],
    ['codeigniter', 'CodeIgniter', 'A builder for CodeIgniter apps with the official auth library, and the spark tool'],
    ['woocommerce', 'WooCommerce', 'A builder for WooCommerce shops on WordPress, with the shop\'s sample products'],
    ['bootstrap', 'Bootstrap', 'A demo site of every Bootstrap component, on 5.3 or 4.6'],
    ['mediawiki', 'MediaWiki', 'A builder for MediaWiki wikis, and its maintenance tool'],
    ['moodle', 'Moodle', 'A builder for Moodle learning sites with a test course, and its CLI tool'],
    ['nextcloud', 'Nextcloud', 'A builder for Nextcloud Server sites from the official release, and the occ tool'],
    ['spring-boot', 'Spring Boot', 'A builder for Spring Boot apps with Spring Security, new or the PetClinic sample, and its wrapper tool'],
    ['aspnet-core', 'ASP.NET Core', 'A builder for ASP.NET Core apps with individual accounts, Razor Pages or a Blazor Web App, and its .NET tool'],
    ['django', 'Django', 'A builder for Django projects with the admin, and the manage tool'],
    ['nextjs', 'Next.js', 'A builder for Next.js apps (the Learn course or the default app), and its CLI tool'],
    ['strapi', 'Strapi', 'A builder for Strapi apps (Community Edition) on PostgreSQL, and the strapi tool'],
    ['docusaurus', 'Docusaurus', 'A builder for Docusaurus documentation sites, served as a production build'],
    ['discourse', 'Discourse', 'A builder for Discourse forums, installed the official way, and the forum\'s Rails tool'],
    ['payload', 'Payload', 'A builder for Payload apps (the website or the blank template) on PostgreSQL, and the payload tool'],
  ] },
  { id: 'workspaces', label: 'Workspace folders', about: 'A folder of projects or items, with its settings file and its commands.', plugins: [
    ['dev', 'Dev', 'Development sites: the Drupal, Drupal CMS and Webship builders'],
    ['test', 'Test', 'Test sites, with the automated-testing stack'],
    ['sandboxes', 'Sandboxes', 'Throwaway experiments'], ['demos', 'Demos', 'Demo sites'],
    ['projects', 'Projects', 'Client projects'], ['products', 'Products', 'Webship products'],
    ['drupal-site-templates', 'Drupal site templates', 'Site templates, built and kept as packages'],
    ['drupal-modules', 'Drupal modules', 'Contrib and private modules'], ['drupal-themes', 'Drupal themes', 'Themes, built and kept as packages'],
    ['drupal-recipes', 'Drupal recipes', 'Recipes, built and kept as packages'], ['drupal-profiles', 'Drupal profiles', 'Installation profiles'],
    ['libraries', 'Libraries', 'Third-party libraries'], ['docs', 'Docs', 'Markdown documents, edited in place'],
    ['specs', 'Specs', 'Specifications, written before the work'], ['worklogs', 'Worklogs', 'Session worklogs, dated and kept as written'],
    ['images', 'Images', 'Pictures made and kept here'], ['video', 'Videos', 'Recordings, with their scripts'], ['audio', 'Audio', 'Voices, sounds and music'],
    ['designs', 'Designs', 'Penpot designs'],
    ['graph', 'Graphs', 'Knowledge graphs of your projects, and the Graph menu'], ['rag', 'RAG', 'Search indexes of your projects, and the RAG menu'],
  ] },
  { id: 'ai', label: 'AI', about: 'Agents, skills, commands and prompts, kept as files and installed into an AI CLI.', plugins: [
    ['ai-agents', 'AI Agents', 'Agents, kept as files and installed into an AI CLI'],
    ['ai-skills', 'AI Skills', 'Skills, kept as folders and installed into an AI CLI'],
    ['ai-commands', 'AI Commands', 'Slash commands, kept as files and installed into an AI CLI'],
    ['ai-prompts', 'AI Prompts', 'Prompts to reuse, kept as files'],
  ] },
  { id: 'hosting', label: 'Hosting providers', about: 'Link a project to its host: environments and live URLs, get the database and files, deploy, logs.', plugins: [
    ['upsun', 'Upsun', 'Environments, data, deploys and logs of a project on Upsun'],
    ['acquia', 'Acquia Cloud', 'Environments, data, deploys and logs of a project on Acquia Cloud'],
    ['digitalocean', 'DigitalOcean', 'Apps, deploys and logs of a project on DigitalOcean App Platform'],
    ['cpanel', 'cPanel', 'Domains, data, deploys and the error log of a cPanel account'],
    ['aws', 'AWS', 'Environments, deploys and logs of a project on AWS Elastic Beanstalk'],
    ['azure', 'Azure', 'Deploys and logs of a project on Azure App Service'],
    ['godaddy', 'GoDaddy', 'Data and deploys of a site hosted at GoDaddy'],
  ] },
  { id: 'forges', label: 'Git forges', about: 'The repository, its issues and pull requests, and the credential the dashboard uses there.', plugins: [
    ['github', 'GitHub', 'The repository, issues and pull requests of projects on GitHub'],
    ['gitlab', 'GitLab', 'The repository, issues and merge requests of projects on GitLab (git.drupalcode.org by default)'],
    ['bitbucket', 'Bitbucket', 'The repository, issues and pull requests of projects on Bitbucket'],
  ] },
  { id: 'containers', label: 'Container runtimes', about: 'A menu for projects that run on a runtime other than the default one.', plugins: [
    ['docker', 'Docker Compose', 'Up, down, logs and a shell for projects with a compose file'],
    ['lando', 'Lando', 'Start, stop, rebuild and logs for projects with a .lando.yml'],
    ['docksal', 'Docksal', 'Start, stop and logs for projects with a .docksal folder'],
    ['podman', 'Podman', 'Build, run and logs for projects with a Containerfile'],
    ['kubernetes', 'Kubernetes', 'Apply, status and logs for projects with Kubernetes manifests'],
  ] },
  { id: 'features', label: 'Features', about: 'A menu, a page or a service the base does not carry.', plugins: [
    ['git', 'Git', 'The GIT menu on every project row'],
    ['ide', 'Web IDE', 'VS Code in the browser, and the IDE menu'],
    ['jira', 'Jira', 'Jira work items, through the Teamwork Graph CLI'],
    ['google-drive', 'Google Drive', 'Sync a workspace folder to Google Drive, and its MCP server'],
    ['screens', 'Screens and terminals', 'Screen sessions, terminals and container shells for every command'],
    ['avatar', 'Avatars', 'Avatars and the talking assistant'],
  ] },
];

/** Every catalogue entry, flat: { name (its id), module, label (its name), summary, family, familyLabel }. */
function catalog() {
  const out = [];
  for (const f of FAMILIES) for (const [name, label, summary] of f.plugins) out.push({ name, module: `${SCOPE}/workspace-${name}`, label, summary, family: f.id, familyLabel: f.label });
  return out;
}

module.exports = { SCOPE, FAMILIES, catalog };
