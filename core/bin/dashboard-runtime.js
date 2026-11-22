/**
 * Where the dashboard itself runs (webship/workspace#694): in its DDEV project (the default, core/workspace-app/.ddev),
 * on Docker Compose (core/docker) or on Kubernetes (core/k8s, a Helm chart).
 *
 *   webship-workspace init <dir> --runtime docker|kubernetes     writes this machine's values and starts it
 *   webship-workspace start|stop|status [dir]                    on the runtime the workspace was made for
 *
 * A workspace's dashboard runtime is what it carries, as a project's is: core/docker/.env is Docker Compose,
 * core/k8s/values.local.yaml is Kubernetes, neither is DDEV. `container.runtime` in settings.yml is written at
 * init, so the builders build sites on the same runtime by default; it can be changed there without moving the
 * dashboard.
 *
 * Plain Node, no dependencies, like workspace.js: it runs before anything is installed.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUNTIMES = ['ddev', 'docker', 'kubernetes'];
const TITLES = { ddev: 'DDEV', docker: 'Docker Compose', kubernetes: 'Kubernetes' };

const DOCKER_DIR = path.join('core', 'docker');
const DOCKER_ENV = path.join(DOCKER_DIR, '.env');
const K8S_DIR = path.join('core', 'k8s');
const K8S_VALUES = path.join(K8S_DIR, 'values.local.yaml');
const SOCKET = '/var/run/docker.sock';
// The PHP version of the web image a kind cluster is given for the sites built from the dashboard's pod.
const SITE_PHP = '8.3';

// The flags that take a value: `--runtime docker` and `--runtime=docker` are the same.
const VALUE_FLAGS = new Set(['runtime', 'port', 'context', 'namespace', 'image', 'node-port', 'release', 'php']);

/** A command line's words: the ones that are not flags, and the flags. */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const eq = a.indexOf('=');
    const name = (eq === -1 ? a.slice(2) : a.slice(2, eq));
    if (eq !== -1) flags[name] = a.slice(eq + 1);
    else if (VALUE_FLAGS.has(name) && i + 1 < argv.length && !String(argv[i + 1]).startsWith('--')) { flags[name] = String(argv[i + 1]); i += 1; }
    else flags[name] = true;
  }
  return { positional, flags };
}

/** The runtime a `--runtime` names, or the reason it is not one. */
function askedRuntime(flags) {
  if (flags.runtime === undefined) return { runtime: '' };
  const r = String(flags.runtime).toLowerCase().replace(/^k8s$/, 'kubernetes').replace(/^compose$/, 'docker');
  if (flags.runtime === true || !RUNTIMES.includes(r)) return { error: `--runtime takes one of: ${RUNTIMES.join(', ')}.` };
  return { runtime: r };
}

/** The runtime the dashboard of this workspace runs on, from what the workspace carries. */
function runtimeOf(dest) {
  if (fs.existsSync(path.join(dest, DOCKER_ENV))) return 'docker';
  if (fs.existsSync(path.join(dest, K8S_VALUES))) return 'kubernetes';
  return 'ddev';
}

/**
 * `container.runtime` in settings.yml: the runtime the builders build sites on by default
 * (core/scripts/functions/fun-runtime.sh reads it as container_runtime). The line is changed where it is, or the
 * block is added at the end; nothing else in the file moves. True when the file was changed.
 */
function recordRuntime(dest, runtime) {
  const file = path.join(dest, 'core', 'config', 'settings.yml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return false; }
  const block = text.match(/^container:[ \t]*\n((?:[ \t]+.*\n|[ \t]*\n)*)/m);
  let next;
  if (block && /^[ \t]+runtime:.*$/m.test(block[1])) {
    next = text.replace(block[0], block[0].replace(/^([ \t]+runtime:)[ \t]*.*$/m, `$1 ${runtime}`));
  } else if (block) {
    next = text.replace(/^container:[ \t]*\n/m, `container:\n  runtime: ${runtime}\n`);
  } else {
    next = `${text.replace(/\n*$/, '\n')}\n# The container runtime the builders build sites on by default: ddev, docker (Docker Compose), podman or\n`
      + `# kubernetes. A builder's --runtime still wins for one build.\ncontainer:\n  runtime: ${runtime}\n`;
  }
  if (next === text) return false;
  fs.writeFileSync(file, next);
  return true;
}

/** The KEY=value lines of an env file. */
function readEnv(file) {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return out; }
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** A name for this workspace's compose project and Helm release: webship-workspace for ~/workspace, its own otherwise. */
function projectName(dest) {
  if (path.resolve(dest) === path.join(os.homedir(), 'workspace')) return 'webship-workspace';
  const slug = path.basename(dest).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'workspace';
  return `webship-${slug}-${crypto.createHash('sha1').update(path.resolve(dest)).digest('hex').slice(0, 6)}`;
}

/** The first port from `from` that nothing on 127.0.0.1 listens on. */
function freePort(from = 3000) {
  const script = `const net=require('net');const t=(p)=>{if(p>${from}+200){console.log('');return;}const s=net.createServer();`
    + `s.once('error',()=>t(p+1));s.once('listening',()=>s.close(()=>console.log(p)));s.listen(p,'127.0.0.1');};t(${from});`;
  const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return Number(String(r.stdout || '').trim()) || from;
}

/** The group of the host's Docker socket, or '' when there is none. */
function dockerGid(socket = process.env.WEBSHIP_WORKSPACE_DOCKER_SOCKET || SOCKET) {
  try { return String(fs.statSync(socket).gid); } catch (_) { return ''; }
}

/**
 * core/docker/.env: this machine's values for the compose file. What is already there is kept (the port, the
 * project's name, lines a person added); what the flags name is taken; the user and group numbers and the Docker
 * socket's group are this machine's, read again each time. Answers the values.
 */
function writeDockerEnv(dest, flags = {}) {
  const file = path.join(dest, DOCKER_ENV);
  const old = readEnv(file);
  const home = os.homedir();
  const claude = !flags['no-claude'] && fs.existsSync(path.join(home, '.claude')) && fs.existsSync(path.join(home, '.claude.json'));
  const env = {
    ...old,
    COMPOSE_PROJECT_NAME: old.COMPOSE_PROJECT_NAME || projectName(dest),
    COMPOSE_FILE: claude ? 'compose.yaml:compose.claude.yaml' : 'compose.yaml',
    WORKSPACE_ROOT: path.resolve(dest),
    WORKSPACE_UID: String(typeof process.getuid === 'function' ? process.getuid() : 1000),
    WORKSPACE_GID: String(typeof process.getgid === 'function' ? process.getgid() : 1000),
    DOCKER_GID: dockerGid() || old.DOCKER_GID || '999',
    PORT: String(flags.port && flags.port !== true ? flags.port : (old.PORT || freePort(3000))),
    WORKSPACE_LISTEN: old.WORKSPACE_LISTEN || '127.0.0.1',
    HOST_HOME: home,
  };
  if (flags.image && flags.image !== true) env.WORKSPACE_IMAGE = String(flags.image);
  const head = '# Written by webship-workspace (init --runtime docker): this machine\'s values for core/docker/compose.yaml.\n'
    + '# Kept on update. PORT, WORKSPACE_LISTEN and WORKSPACE_ALLOWED_HOSTS are yours to change; then: webship-workspace start\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${head}${Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  return env;
}

/**
 * docker compose in core/docker, with the .env's values in the environment too: compose prefers the shell's
 * variables to the file's, and a shell may carry another workspace's WORKSPACE_ROOT or PORT.
 */
function compose(dest, args, { capture = false } = {}) {
  const dir = path.join(dest, DOCKER_DIR);
  const env = { ...process.env, ...readEnv(path.join(dest, DOCKER_ENV)) };
  return spawnSync('docker', ['compose', ...args], { cwd: dir, env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
}

const dockerAddress = (dest) => `http://127.0.0.1:${readEnv(path.join(dest, DOCKER_ENV)).PORT || 3000}`;

/** Is the dashboard's container of this workspace running? */
function dockerRunning(dest) {
  const r = compose(dest, ['ps', '-q', '--status', 'running', 'dashboard'], { capture: true });
  return !r.error && r.status === 0 && !!String(r.stdout || '').trim();
}

/** Start the dashboard on Docker Compose: 'started', 'failed' or 'no-docker', said as it goes. */
function dockerStart(dest, say, flags = {}) {
  const docker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (docker.error || docker.status !== 0 || !dockerGid()) {
    say('  Docker with the compose plugin is not running here: the dashboard runs in a container. Install it (https://docs.docker.com/engine/install/) and run:  webship-workspace start');
    return 'no-docker';
  }
  const env = writeDockerEnv(dest, flags);
  say(`  starting the dashboard (docker compose up in core/docker, port ${env.PORT})…`);
  const up = compose(dest, ['up', '-d', '--build', '--wait']);
  return !up.error && up.status === 0 ? 'started' : 'failed';
}

function dockerStop(dest, say) {
  const r = compose(dest, ['stop']);
  const ok = !r.error && r.status === 0;
  say(ok ? 'The dashboard is stopped. Its sites keep running; start it again with:  webship-workspace start' : 'The dashboard did not stop: read what docker said above.');
  return ok;
}

function dockerStatus(dest, say) {
  const running = dockerRunning(dest);
  say(`The dashboard of ${dest} runs on Docker Compose (core/docker): ${running ? `running at ${dockerAddress(dest)}` : 'stopped'}.`);
  compose(dest, ['ps', '--all']);
  return running;
}

// ---------------------------------------------------------------------------------------------- Kubernetes --

/** The values the init wrote for the chart, read back: the context, the namespace, the release, the image. */
function readKube(dest) {
  let text = '';
  try { text = fs.readFileSync(path.join(dest, K8S_VALUES), 'utf8'); } catch (_) { return null; }
  const of = (key) => (text.match(new RegExp(`^  ${key}:[ \\t]*"?([^"\\n]*)"?[ \\t]*$`, 'm')) || [])[1] || '';
  return { context: of('context'), namespace: of('namespace'), release: of('release'), image: of('image'), nodePort: of('nodePort') };
}

const kubectl = (ctx, args, opts = {}) => spawnSync('kubectl', ['--context', ctx, ...args], { encoding: 'utf8', stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });

/** The cluster's current context, or ''. */
function currentContext() {
  const r = spawnSync('kubectl', ['config', 'current-context'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return r.error || r.status !== 0 ? '' : String(r.stdout || '').trim();
}

/**
 * core/k8s/values.local.yaml: this machine's values for the chart. The workspace is a folder of the node, at the
 * same path (hostPath), which is what a local cluster and a single-node one give; the dashboard runs as this
 * user. `install:` is not the chart's: it is where the init keeps the context, namespace and release for start,
 * stop and status.
 */
function writeKubeValues(dest, flags = {}) {
  const old = readKube(dest) || {};
  const pick = (name, fallback) => (flags[name] && flags[name] !== true ? String(flags[name]) : fallback);
  const install = {
    context: pick('context', old.context || process.env.WORKSPACE_KUBE_CONTEXT || currentContext()),
    namespace: pick('namespace', old.namespace || 'webship-workspace'),
    release: pick('release', old.release || projectName(dest)),
    image: pick('image', old.image || 'webship-workspace:local'),
  };
  const nodePort = pick('node-port', old.nodePort || '');
  // name:tag, where a colon before a slash is a registry's port (localhost:5000/name), not a tag.
  const cut = install.image.lastIndexOf(':');
  const tagged = cut > 0 && !install.image.slice(cut + 1).includes('/');
  const [repository, tag] = tagged ? [install.image.slice(0, cut), install.image.slice(cut + 1)] : [install.image, 'latest'];
  // The default image is built on this machine; any other is one the cluster pulls.
  const local = install.image === 'webship-workspace:local';
  const text = `# Written by webship-workspace (init --runtime kubernetes): this machine's values for the chart in core/k8s.
# Kept on update. Apply a change with:  webship-workspace start
install:
  context: "${install.context}"
  namespace: "${install.namespace}"
  release: "${install.release}"
  image: "${install.image}"
image:
  repository: "${repository}"
  tag: "${tag}"
  pullPolicy: ${local ? 'Never' : 'IfNotPresent'}
workspace:
  path: "${path.resolve(dest)}"
  hostPath: "${path.resolve(dest)}"
runAs:
  user: ${typeof process.getuid === 'function' ? process.getuid() : 1000}
  group: ${typeof process.getgid === 'function' ? process.getgid() : 1000}
service:
  type: NodePort
  nodePort: ${nodePort || '""'}
`;
  fs.mkdirSync(path.join(dest, K8S_DIR), { recursive: true });
  fs.writeFileSync(path.join(dest, K8S_VALUES), text);
  return { ...install, local, nodePort };
}

/** Where the dashboard answers on the cluster: the node's address and the Service's NodePort, or how to forward it. */
function kubeAddress(k) {
  const svc = kubectl(k.context, ['-n', k.namespace, 'get', 'svc', k.release, '-o', 'jsonpath={.spec.type} {.spec.ports[0].nodePort}'], { capture: true });
  const [type, port] = String(svc.stdout || '').trim().split(' ');
  if (type === 'NodePort' && port) {
    const node = kubectl(k.context, ['get', 'nodes', '-o', 'jsonpath={.items[0].status.addresses[?(@.type=="InternalIP")].address}'], { capture: true });
    const ip = String(node.stdout || '').trim();
    if (ip) return `http://${ip}:${port}`;
  }
  return `kubectl --context ${k.context} -n ${k.namespace} port-forward svc/${k.release} 3000:3000   (then http://127.0.0.1:3000)`;
}

/** Start the dashboard on Kubernetes: 'started', 'failed', 'no-kubectl', 'no-helm' or 'no-cluster'. */
function kubeStart(dest, say, flags = {}) {
  for (const [cli, word, how] of [['kubectl', 'no-kubectl', 'https://kubernetes.io/docs/tasks/tools/'], ['helm', 'no-helm', 'https://helm.sh/docs/intro/install/']]) {
    const r = spawnSync(cli, ['version', '--client'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error) { say(`  ${cli} is not installed: the dashboard on Kubernetes is installed with it (${how}). Then:  webship-workspace start`); return word; }
  }
  const k = writeKubeValues(dest, flags);
  if (!k.context) { say('  No Kubernetes context: name one with --context, or set WORKSPACE_KUBE_CONTEXT.'); return 'no-cluster'; }
  const nodes = kubectl(k.context, ['get', 'nodes', '-o', 'name'], { capture: true });
  if (nodes.error || nodes.status !== 0) { say(`  No cluster answers on the context ${k.context}: ${String(nodes.stderr || '').trim().split('\n')[0]}`); return 'no-cluster'; }
  if (k.local) {
    // The image is built here and, on a kind cluster, loaded into its node. Any other cluster needs an image it
    // can pull: --image <registry/name:tag>.
    say(`  building the dashboard's image ${k.image} (docker build core/docker)…`);
    const built = spawnSync('docker', ['build', '-q', '-t', k.image, path.join(dest, DOCKER_DIR)], { stdio: 'inherit' });
    if (built.error || built.status !== 0) { say('  The image did not build: read what docker said above.'); return 'failed'; }
    if (/^kind-/.test(k.context)) {
      say(`  loading it into the kind cluster ${k.context.replace(/^kind-/, '')}…`);
      const loaded = spawnSync('kind', ['load', 'docker-image', k.image, '--name', k.context.replace(/^kind-/, '')], { stdio: 'inherit' });
      if (loaded.error || loaded.status !== 0) { say('  kind could not load the image: is kind installed, and the cluster a kind one?'); return 'failed'; }
      // A pod has no Docker to build a site's web image with: the sites built from the dashboard's pod take one
      // image per PHP version, built here once from the php stack (the chart's sites.webImage names it).
      const php = flags.php && flags.php !== true ? String(flags.php) : SITE_PHP;
      const web = `webship-workspace-php:${php}`;
      if (flags['no-sites-image']) {
        say(`  The sites' web image ${web} is left out (--no-sites-image): the dashboard runs, and a site built from it on this cluster waits for that image.`);
      } else {
        say(`  building the sites' web image ${web} and loading it (PHP ${php}; another version: --php <version>)…`);
        const args = ['build', '-q', '-t', web, '--build-arg', `PHP_VERSION=${php}`, '--build-arg', `UID=${process.getuid()}`, '--build-arg', `GID=${process.getgid()}`,
          path.join(dest, 'core', 'config', 'runtimes', 'php')];
        const ok = spawnSync('docker', args, { stdio: 'inherit' }).status === 0
          && spawnSync('kind', ['load', 'docker-image', web, '--name', k.context.replace(/^kind-/, '')], { stdio: 'inherit' }).status === 0;
        if (!ok) say(`  The sites' web image was not loaded: the dashboard runs, and a site built from it on this cluster waits for ${web}.`);
      }
    } else {
      say(`  The context ${k.context} is not a kind cluster: its nodes must already have ${k.image}, or name one they can pull with --image.`);
    }
  }
  // A local image keeps its tag when it is built again: its id on the pod makes the pod new when the image is.
  const built = k.local ? String(spawnSync('docker', ['image', 'inspect', '-f', '{{.Id}}', k.image], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).stdout || '').trim() : '';
  const stamp = /^sha256:[0-9a-f]+$/.test(built) ? ['--set-string', `podAnnotations.webship\\.co/image=${built}`] : [];
  say(`  installing the chart (helm upgrade --install ${k.release}, namespace ${k.namespace}, context ${k.context})…`);
  const helm = spawnSync('helm', ['upgrade', '--install', k.release, path.join(dest, K8S_DIR), '--kube-context', k.context, '--namespace', k.namespace,
    '--create-namespace', '-f', path.join(dest, K8S_VALUES), ...stamp, '--wait', '--timeout', '10m'], { stdio: 'inherit' });
  return !helm.error && helm.status === 0 ? 'started' : 'failed';
}

/** Is the dashboard's pod of this workspace up? */
function kubeRunning(dest) {
  const k = readKube(dest);
  if (!k || !k.context) return false;
  const r = kubectl(k.context, ['-n', k.namespace, 'get', `deploy/${k.release}`, '-o', 'jsonpath={.status.availableReplicas}'], { capture: true });
  return !r.error && r.status === 0 && Number(String(r.stdout || '').trim()) >= 1;
}

function kubeStop(dest, say) {
  const k = readKube(dest);
  const r = kubectl(k.context, ['-n', k.namespace, 'scale', `deploy/${k.release}`, '--replicas=0']);
  const ok = !r.error && r.status === 0;
  say(ok ? 'The dashboard is stopped (no pod). Its sites keep running; start it again with:  webship-workspace start' : 'The dashboard did not stop: read what kubectl said above.');
  return ok;
}

function kubeStatus(dest, say) {
  const k = readKube(dest);
  const running = kubeRunning(dest);
  say(`The dashboard of ${dest} runs on Kubernetes (context ${k.context}, namespace ${k.namespace}): ${running ? `running at ${kubeAddress(k)}` : 'stopped'}.`);
  kubectl(k.context, ['-n', k.namespace, 'get', 'deploy,pods,svc', '-l', `app.kubernetes.io/instance=${k.release}`]);
  return running;
}

/**
 * The dashboard leaves a runtime (an init that names another one): its container or pod is stopped and this
 * machine's values for it go, so the workspace carries one runtime. A DDEV project is never stopped from here:
 * it is said how.
 */
function leave(dest, runtime, say, { stop = true } = {}) {
  if (runtime === 'docker') {
    if (stop) compose(dest, ['down'], { capture: true });
    fs.rmSync(path.join(dest, DOCKER_ENV), { force: true });
  } else if (runtime === 'kubernetes') {
    const k = readKube(dest);
    if (stop && k && k.context) kubectl(k.context, ['-n', k.namespace, 'scale', `deploy/${k.release}`, '--replicas=0'], { capture: true });
    fs.rmSync(path.join(dest, K8S_VALUES), { force: true });
    if (k && k.context) say(`  Its release stays on the cluster, with no pod. To remove it:  helm --kube-context ${k.context} -n ${k.namespace} uninstall ${k.release}`);
  } else {
    say(`  Its DDEV project is left as it is. One dashboard serves a workspace: stop that one with  cd ${path.join(dest, 'core', 'workspace-app')} && ddev stop`);
  }
}

module.exports = {
  leave,
  RUNTIMES, TITLES, DOCKER_ENV, K8S_VALUES, parseArgs, askedRuntime, runtimeOf, recordRuntime, readEnv, projectName, freePort, dockerGid,
  writeDockerEnv, compose, dockerAddress, dockerRunning, dockerStart, dockerStop, dockerStatus,
  readKube, writeKubeValues, kubeAddress, kubeRunning, kubeStart, kubeStop, kubeStatus,
};
