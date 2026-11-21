# Using plugins: a help guide

The base ships empty. Every folder, platform, hosting provider and feature you see in the dashboard is a plugin you added. This guide is the user's side of them: how to find one, add it, set it up, use it, keep it up to date and take it out again. [Plugins](plugins.md) is the reference behind it, and each plugin's own README says what that plugin does in detail.

## Find a plugin

- **In the dashboard:** Settings → Plugins. The catalogue is grouped by family (Platforms, Workspace folders, Hosting providers, Git forges, Container runtimes, Features) and has a filter. Each card says what the plugin does and has an **Add** button. A plugin that is already here shows its step, and **Update to** a newer version when there is one.
- **In a terminal:** `webship-workspace catalog` lists the same plugins with their families.

## Add one

**From the dashboard:**

1. Settings → Plugins → **Add** on its card. npm installs the package into the dashboard (the *require* step), and the plugin's page opens.
2. **Activate** turns it on. A workspace folder joins the home page and the left navigation.
3. **Install** places what it brings: its commands, menus, compose files and AI items. The record it keeps is what lets **Uninstall** take them out again later.
4. **Configure** opens its settings file, when it has one. A plugin with nothing to configure says it is ready.

A plugin can need another one: a platform plugin needs a sites folder (Dev, Test, Sandboxes or Demos) for its builder, and the AI Agents folder for its agents. Before Activate, its page asks whether to add what it needs too. Yes adds those first; no changes nothing and says what is missing.

**From a terminal:** the same four steps, each one command.

```bash
webship-workspace plugin require wordpress
webship-workspace plugin activate wordpress --with-needs   # adds what it needs first
webship-workspace plugin install wordpress
webship-workspace plugin configure wordpress               # only when it has settings
```

## Set it up

- **Configure** opens `core/config/plugin.<name>.settings.yml`. Each key is described where it is. A secret, such as an API token, stays in that file on your machine; the dashboard shows it masked, and the file is not part of any repository.
- **Some plugins call a command on your machine:** a hosting provider's CLI, `twg` for Jira, `curl`. `webship-workspace doctor` lists what the core and every plugin call, each one found with its version or missing with how to install it. `webship-workspace plugin check <name>` does the same for one plugin. Nothing is installed for you.

## Where it shows up

| Family | After Install you find |
| --- | --- |
| Workspace folders | A card on the home page and the folder's own page: its items, their menus and its add or new button. |
| Platforms | A builder in the Build form of a sites folder, with its options; its tool command; its test users in the Tests menu; its step pack in the testing setup; its AI agents in the AI Agents folder. |
| Hosting providers | A button on each project row (UPSUN, ACQUIA and the others): environments and live sites, get the database and files, deploy, logs. |
| Git forges | On a project whose remote is on that host: the repository, the issues, and the pull or merge requests. |
| Container runtimes | A menu on projects with a compose file, a `.lando.yml`, a `.docksal/` folder, a `Containerfile` or Kubernetes manifests. |
| Features | Their own button or page: GIT, IDE, JIRA, Screens, Graph, RAG, the assistant's avatar, Google Drive and the others. |

Settings → **Buttons** sets which buttons a project row shows, and in what order. The switches above a folder's projects show the tools with their words or as icons, a choice your browser keeps.

## Build and test a site with a platform plugin

1. Open a sites folder (Dev, for example), press **Build**, choose the platform, fill in its options and build. The build runs in a screen session; Screens shows it, and you can follow its log.
2. The new project's row has DDEV (start, stop, open the site), the platform's tool and **Tests**.
3. Tests → **Set up the testing environment**: Webship-js and the platform's step pack go into the project.
4. Tests → **Add the test users**: the accounts of that platform. They come from the plugin that claims the project, so an app that is neither Drupal nor claimed by a plugin is offered none.
5. Tests → **Run the tests**, or **Run one feature…**. The report, and the screenshot and recording of a failed step, appear in the Tests menu. **Extra steps…** adds another step pack to the project, such as one for a service the site uses.

## Keep plugins up to date

- **In the dashboard:** Settings → Plugins shows **Update to** with the new version on a plugin that has one. When the plugin placed files, press **Reinstall** after the update.
- **In a terminal:** `webship-workspace plugin require <name>@latest`, then `webship-workspace plugin install <name>` again when it placed files.
- **The whole workspace:** `webship-workspace update` brings the base to the new release and keeps every plugin you required. The packages the plugins share (a family's base, such as the hosting base under the hosting providers) come to their newest version too.

## Turn one off, or take it out

- **Deactivate:** its menus and pages go, its files and settings stay. Activate brings it back as it was.
- **Uninstall:** removes what Install placed. A file you changed is kept, and the step names it.
- **Remove:** takes the npm package out, with its `plugins.<name>` entry in `settings.yml`. Your settings file stays, with the values you set.

A plugin that another one needs cannot be deactivated or uninstalled until that one is. The page says which plugin needs it.

## When something does not work

- The plugin's page in Settings → Plugins says the step it is at and what is missing.
- `webship-workspace doctor` and `webship-workspace plugin check <name>` say which commands are missing, and how to install them.
- `bash core/scripts/plugins.sh --list` shows every plugin's step, what it needs and what needs it.
- The plugin's README has what is particular to it. On webship.co, each plugin's page is that README with a walkthrough in pictures.
