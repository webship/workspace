/**
 * webship-workspace update keeps this machine's own values in the dashboard's .ddev/ (#406): the project's
 * identity of a second workspace on a machine (its name, the hostnames built from it, its fqdns and router
 * ports) and the docker GID docker-gid.sh wrote for this host. The release ships placeholders for both.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', '..', '..', 'bin', 'workspace.js');
const cli = (args) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8',
  env: { ...process.env, WEBSHIP_WORKSPACE_SKIP_NPM: '1', WEBSHIP_WORKSPACE_SKIP_DDEV: '1', WORKSPACE_PLUGINS_NO_RESTART: '1' } });

function workspace() {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ws-machine-')), 'workspace');
  assert.strictEqual(cli(['init', dir]).status, 0);
  const ddev = path.join(dir, 'core', 'workspace-app', '.ddev');
  return { dir, config: path.join(ddev, 'config.yaml'), dockerfile: path.join(ddev, 'web-build', 'Dockerfile.workspace-app'), dood: path.join(ddev, 'docker-compose.dood.yaml') };
}

test('update keeps a second workspace\'s project name, its hostnames, fqdns and ports, and the docker GID of this host', () => {
  const w = workspace();
  const shipped = { config: fs.readFileSync(w.config, 'utf8'), dockerfile: fs.readFileSync(w.dockerfile, 'utf8'), dood: fs.readFileSync(w.dood, 'utf8') };
  // What `ddev config --project-name`, a person and docker-gid.sh leave on this machine.
  fs.writeFileSync(w.config, `${shipped.config.replace(/^name: workspace$/m, 'name: acme-workspace')
    .replace(/^additional_fqdns: \[\]$/m, 'additional_fqdns: [acme.local]')}router_http_port: "8080"\n`);
  const gid = (shipped.dockerfile.match(/groupmod -g (\d+) docker/) || [])[1];
  const mine = gid === '984' ? '985' : '984';
  fs.writeFileSync(w.dockerfile, shipped.dockerfile.replace(/(groupmod|groupadd) -g \d+ docker/g, `$1 -g ${mine} docker`).replace(/usermod -g \d+ \$username/, `usermod -g ${mine} $username`));
  fs.writeFileSync(w.dood, shipped.dood.replace(/(group_add:\s*\n\s*-\s*)"\d+"/, `$1"${mine}"`));

  const u = cli(['update', w.dir]);
  assert.strictEqual(u.status, 0, u.stderr);
  const config = fs.readFileSync(w.config, 'utf8');
  assert.match(config, /^name: acme-workspace$/m);
  assert.match(config, /^- "\*\.dev\.acme-workspace"$/m, 'the hostnames built from the name are renamed with it');
  assert.doesNotMatch(config, /^- "\*\.dev\.workspace"$/m);
  assert.match(config, /^additional_fqdns: \[acme\.local\]$/m);
  assert.match(config, /^router_http_port: "8080"$/m);
  const dockerfile = fs.readFileSync(w.dockerfile, 'utf8');
  assert.match(dockerfile, new RegExp(`groupmod -g ${mine} docker; else groupadd -g ${mine} docker`));
  assert.match(dockerfile, new RegExp(`usermod -g ${mine} \\$username`));
  assert.match(fs.readFileSync(w.dood, 'utf8'), new RegExp(`group_add:\\s*\\n\\s*-\\s*"${mine}"`));
  assert.match(u.stdout, new RegExp(`kept this machine's dashboard: the DDEV project name acme-workspace \\(and the hostnames built from it\\), additional_fqdns \\[acme\\.local\\], router_http_port "8080", the docker GID ${mine}`));
  // Everything else in those files is the release's.
  assert.strictEqual(dockerfile.replace(new RegExp(`(-g )${mine}( docker| \\$username)`, 'g'), `$1${gid}$2`), shipped.dockerfile);
});

test('a workspace that kept the release\'s values is updated without a word about them', () => {
  const w = workspace();
  const u = cli(['update', w.dir]);
  assert.strictEqual(u.status, 0, u.stderr);
  assert.doesNotMatch(u.stdout, /kept this machine's dashboard/);
  assert.match(fs.readFileSync(w.config, 'utf8'), /^name: workspace$/m);
});
