/**
 * The workitems list and the one-workitem modal, as the plugin's fragments:
 *   /fragments/p/jira/list/<ws>/<project>[/results]            the list (the shell first, the rows into #jira-results)
 *   /fragments/p/jira/workitem/<ws>/<project>/<KEY>[/<tab>]      one workitem, a tab per thing to do with it
 */

import fs from 'fs';
import path from 'path';
import type { FragmentContext, PluginApi } from '@webship/workspace-plugin-api';

import type TwgT from './twg';
import type SessionsT from './sessions';

export default function workitems(api: PluginApi, twg: ReturnType<typeof TwgT>, runs: ReturnType<typeof SessionsT>) {
  const { esc, run, humanTime, iconHtml, isValidWorkspace, workspaceDir, tabModalHtml } = api.lib;
  const NAME_RE = /^[a-zA-Z0-9_\-]+$/;
  const settings = () => api.settings.read() || {};
  const base = `/fragments/p/${api.name}`;
  const post = (name: string) => `/actions/p/${api.name}/${name}`;

  /** One workitem: the tab modal, or one of its tabs. */
  async function workitem({ send, searchParams }: FragmentContext, wWs: string, wName: string, wKey: string, wTab: string) {
    if (!isValidWorkspace(wWs) || !NAME_RE.test(wName)) return send('bad target', 400);
    const wiBase = `${base}/workitem/${encodeURIComponent(wWs)}/${encodeURIComponent(wName)}/${encodeURIComponent(wKey)}`;
    const wiWrites = (() => { try { return String(settings().allow_writes) === 'true'; } catch (_) { return false; } })();
    if (!wTab) {
      const asked = searchParams.get('tab') || '';
                return send(tabModalHtml({
        id: 'workitem', title: wKey, subtitle: `${wWs}/${wName}`,
        back: { label: 'Workitems', url: `${base}/list/${encodeURIComponent(wWs)}/${encodeURIComponent(wName)}` },
        active: asked,
        groups: [
          { id: 'workitem', label: 'Workitem', tabs: [
            { id: 'overview', label: 'Overview', icon: 'tabler:info-circle', url: `${wiBase}/overview`, hint: 'What it is, who has it, and the agents that have worked on it' },
            { id: 'analyze', label: 'Analyze', icon: 'tabler:search', url: `${wiBase}/analyze`, hint: 'Claude reads it and the project, and proposes a plan. Read-only' },
            { id: 'work', label: 'Do the work', icon: 'tabler:bolt', url: `${wiBase}/work`, hint: `Start Claude Code in ${wName} with the workitem's prompt` },
            { id: 'runs', label: 'Runs and logs', icon: 'tabler:history', url: `${wiBase}/runs`, hint: 'Every run of this workitem, live or finished' },
          ] },
          ...(wiWrites ? [{ id: 'jira', label: 'On Jira', tabs: [
            { id: 'comment', label: 'Comment', icon: 'tabler:message', url: `${wiBase}/comment`, hint: 'A short comment about the current session work, readable by project managers' },
            { id: 'worklog', label: 'Log work', icon: 'tabler:clock', url: `${wiBase}/worklog`, hint: 'A one-line worklog about the current session work' },
          ] }] : []),
        ],
      }));
    }
            const vals = (mode: string) => esc(JSON.stringify({ workspace: wWs, projectName: wName, key: wKey, mode }));
    const doBtn = (mode: string, icon: string, label: string, cls = 'uk-button-primary') => `<button class="uk-button ${cls}" type="button"
        hx-post="${post('task')}" hx-vals='${vals(mode)}' hx-target="#jw-result" hx-swap="innerHTML">${iconHtml(icon, 0.8)} ${esc(label)}</button>`;
    const result = '<div id="jw-result" class="uk-margin-top" aria-live="polite"></div>';
    if (wTab === 'overview') {
      const q = await run('twg', ['jira', 'workitem', 'query', '--jql', `key = ${wKey}`, '--limit', '1'], process.env.HOME, { timeoutMs: 60 * 1000 });
      let it: any = null;
      try { const raw = String(q.stdout); it = (JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).issues || [])[0] || null; } catch (_) { /* said below */ }
      const scr = String((await run('screen', ['-ls'], process.env.HOME, { timeoutMs: 10 * 1000 })).stdout || '');
      const rows = scr.split('\n').map((l) => l.match(/^\s*\d+\.(\S+)\s+\([^)]*\)(?:\s+\(([^)]*)\))?/)).filter(Boolean).map((m) => ({ session: m[1], state: m[2] || '' })) as { session: string; state: string }[];
      const wiRuns = runs.runsFor(wKey, rows);
      const said = String(q.stderr || q.stdout || '');
      if (!it) {
        return send(twg.twgNeedsLogin(said)
          ? `<div class="msg error"><strong>Not signed in to Jira.</strong> ${esc(twg.TWG_LOGIN_HINT)}</div>`
          : `<div class="msg error">Could not read ${esc(wKey)}.${said ? ` <pre>${esc(said.slice(-300))}</pre>` : ''}</div>`);
      }
      return send(`
        <div class="wi-overview">
          <p><span class="uk-label${it.status?.statusCategory?.key === 'indeterminate' ? ' uk-label-warning' : ''}">${esc(it.status?.name || '?')}</span>
            <a href="${esc(it.url || '#')}" target="_blank" rel="noopener"><strong>${esc(it.key)}</strong></a></p>
          <h4 class="uk-margin-small">${esc(it.summary || '')}</h4>
          <p class="uk-text-meta">${esc(it.issueType?.name || '')} · ${esc(it.assignee?.displayName || 'unassigned')}</p>
          ${wiRuns.length ? `<h5 class="uk-margin-top">${wiRuns.length} run${wiRuns.length === 1 ? '' : 's'}</h5>
            <ul class="uk-list uk-list-divider jira-runs">${wiRuns.map((r) => `<li class="jira-run${r.live ? ' is-live' : ''}">
              ${r.live ? `<button class="uk-button uk-button-default uk-button-small" type="button" data-open-terminal="${esc(r.session)}">${iconHtml('tabler:device-laptop', 0.8)} Open the screen</button> ` : ''}
              <code>${esc(r.session.replace(/^.*--jira-/, ''))}</code>
              ${r.at ? `<span class="uk-text-meta">${esc(humanTime(new Date(r.at)))}</span>` : ''}
              ${r.claude ? `<code title="Reopen that conversation on this machine">claude --resume ${esc(r.claude)}</code>` : ''}
            </li>`).join('')}</ul>` : '<p class="uk-text-meta uk-margin-top">No agent has worked on this yet.</p>'}
        </div>`);
    }
    if (wTab === 'analyze') {
      return send(`<p>Claude reads ${esc(wKey)} and <strong>${esc(wName)}</strong>, then proposes a plan. It is read-only: nothing is changed and nothing is posted to Jira.</p>
        <p>${doBtn('analyze', 'tabler:search', 'Analyze and propose')}</p>${result}`);
    }
    if (wTab === 'work') {
      return send(`<div hx-get="/fragments/screen-new-form?work=${encodeURIComponent(wKey)}&workspace=${encodeURIComponent(wWs)}&project=${encodeURIComponent(wName)}"
          hx-trigger="load" hx-target="this" hx-swap="innerHTML"><span class="uk-text-meta">Loading…</span></div>`);
    }
    if (wTab === 'runs') {
      const log = fs.existsSync(path.join(workspaceDir(wWs), wName, `.jira-${wKey}.log`));
      return send(`<p>${esc(wKey)} has been worked ${log ? 'at least once here; the last run\'s log is below' : 'in no run that left a log in this project'}.</p>
        ${log ? `<p>${doBtn('watch', 'tabler:file-text', 'Show the last log', 'uk-button-default')}</p>` : ''}${result}`);
    }
    if (wTab === 'comment' || wTab === 'worklog') {
      if (!wiWrites) return send('<div class="msg error">Writing to Jira is off (allow_writes in plugin.jira.settings.yml).</div>');
      const copy = wTab === 'comment'
        ? 'Claude writes a short comment about the current session work, in words a project manager can read, and posts it on the workitem.'
        : 'Claude adds a one-line worklog about the current session work.';
      return send(`<p>${esc(copy)}</p><p>${doBtn(wTab, wTab === 'comment' ? 'tabler:message' : 'tabler:clock', wTab === 'comment' ? 'Post the comment' : 'Add the worklog')}</p>${result}`);
    }
    return send('<div class="msg error">No such tab.</div>');
  }

  /** The list: the shell at once, then the rows into #jira-results. */
  async function list({ send, searchParams }: FragmentContext, jWs: string, jName: string, jResults: string) {
    if (!isValidWorkspace(jWs) || !NAME_RE.test(jName)) return send('bad target', 400);
    const jiraCfg = (() => { try { return settings(); } catch (_) { return {}; } })();
    // What twg can see is cached for ten minutes. A modal that waits for it opens in seconds on a cold
    // cache, so it opens on the allowlist or the default at once and asks in the background; the
    // next opening has the whole list.
    const live = twg.jiraProjectListCached();
    if (!live) twg.warmJiraProjects();
    // jira.projects, when set, is the ALLOWLIST: only these projects are offered,
    // whatever twg can see. Empty or absent means everything twg can see.
    const allowed: string[] = (Array.isArray(jiraCfg.projects) ? jiraCfg.projects : [])
      .map((k) => String(k || '').trim().toUpperCase()).filter((k) => /^[A-Z][A-Z0-9]+$/.test(k));
    const fallback = (allowed.length ? allowed : [String(jiraCfg.default_project || '').trim().toUpperCase()])
      .filter((k) => /^[A-Z][A-Z0-9]+$/.test(k)).map((k) => ({ key: k, name: '' }));
    const jiraChoices = (live && live.length)
      ? (allowed.length ? live.filter((p) => allowed.includes(p.key)) : live)
      : fallback;
    const jiraProjects = jiraChoices.map((c) => c.key);
    if (!jiraProjects.length) { return send('no jira projects reachable or configured', 400); }
    const allowWrites = String(jiraCfg.allow_writes) === 'true';
            const asked = String(searchParams.get('project') || '').toUpperCase();
    const ownKey = twg.projectJiraKey(path.join(workspaceDir(jWs), jName));
    const jiraProject = jiraProjects.includes(asked) ? asked
      : (ownKey && jiraProjects.includes(ownKey)) ? ownKey
      : (jiraProjects.includes(String(jiraCfg.default_project || '').toUpperCase()) ? String(jiraCfg.default_project).toUpperCase() : jiraProjects[0]);
    const text = String(searchParams.get('q') || '').replace(/["\\]/g, '').slice(0, 100);
    // A Jira key in the filter jumps straight to that workitem, whatever its status.
    const keyAsked = /^[A-Z][A-Z0-9]+-[0-9]+$/.test(text.toUpperCase().trim()) ? text.toUpperCase().trim() : null;
    const scopeAsked = searchParams.get('scope');
    const jiraAccount = String(jiraCfg.account || '').trim();
    const accountOk = /^[a-zA-Z0-9@._:-]+$/.test(jiraAccount);
    // My workitems is the default view when settings name the user.
    const scope = ['sprint', 'mine', 'open'].includes(scopeAsked) ? scopeAsked : (accountOk ? 'mine' : 'open');
    const scopeJql = scope === 'sprint' ? ' AND sprint in openSprints()'
      : (scope === 'mine' && accountOk) ? ` AND assignee = "${jiraAccount}"` : '';
    const jql = keyAsked
      ? `key = ${keyAsked}`
      : `project = ${jiraProject}${scopeJql}${text ? ` AND text ~ "${text}"` : ''} AND statusCategory != Done ORDER BY updated DESC`;
    if (!jResults) {
      // The modal opens at once with its controls; the workitems arrive into #jira-results. Opening it
      // used to wait for three commands in a row, and a filter replaced the whole modal, input and all.
      const listBase = `${base}/list/${encodeURIComponent(jWs)}/${encodeURIComponent(jName)}`;
      const resultsUrl = `${listBase}/results?project=${encodeURIComponent(jiraProject)}&scope=${encodeURIComponent(scope)}${text ? `&q=${encodeURIComponent(text)}` : ''}`;
                return send(`
<div class="editor-card">
  <h3 class="uk-margin-small-bottom">${esc(jiraProject)} workitems — for ${esc(jWs)}/${esc(jName)}</h3>
  <p class="uk-text-meta">Open workitems from Jira, through the Teamwork Graph CLI. Analyze first;
    "Do the work" runs Claude Code inside the project and ends by commenting and logging on the workitem.</p>
  <form hx-get="${listBase}/results" hx-target="#jira-results" hx-swap="innerHTML" hx-sync="this:replace"
        hx-trigger="input changed delay:350ms from:find input[name=q], change from:find select[name=scope], submit">
    <label class="uk-form-label">Jira project
      <select class="uk-select uk-margin-small-bottom" name="project" hx-get="${listBase}" hx-target="#editor-modal-body"
              hx-swap="innerHTML" hx-include="closest form" hx-trigger="change">
        ${jiraChoices.map((c) => `<option value="${esc(c.key)}"${c.key === jiraProject ? ' selected' : ''}>${esc(c.key)}${c.name ? ` — ${esc(c.name)}` : ''}</option>`).join('')}
      </select>
    </label>
    <p class="uk-text-meta">${ownKey === jiraProject
      ? `✓ ${esc(jName)} remembers ${esc(jiraProject)} <button type="button" class="uk-button uk-button-default uk-button-small" hx-post="${post('set-project')}" hx-target="#editor-modal-body" hx-swap="innerHTML" hx-vals='{"workspace":"${esc(jWs)}","projectName":"${esc(jName)}","key":""}'>Forget</button>`
      : `<button type="button" class="uk-button uk-button-default uk-button-small" hx-post="${post('set-project')}" hx-target="#editor-modal-body" hx-swap="innerHTML" hx-vals='{"workspace":"${esc(jWs)}","projectName":"${esc(jName)}","key":"${esc(jiraProject)}"}'>Remember ${esc(jiraProject)} for ${esc(jName)}</button> <span>so this project opens on it, not the global default</span>`}</p>
    <label class="uk-form-label">Scope
      <select class="uk-select uk-margin-small-bottom" name="scope">
        <option value="open"${scope === 'open' ? ' selected' : ''}>All open workitems</option>
        <option value="sprint"${scope === 'sprint' ? ' selected' : ''}>Active sprints only</option>
        ${accountOk ? `<option value="mine"${scope === 'mine' ? ' selected' : ''}>My workitems (${esc(jiraAccount)})</option>` : ''}
      </select>
    </label>
    <input class="uk-input uk-margin-small-bottom" name="q" value="${esc(text)}" autocomplete="off" type="search" data-list-find="#jira-results"
           placeholder="Filter by text, or jump to a key (WEBSHIP-1234)…" aria-label="Filter the workitems">
  </form>
  ${allowWrites ? '' : `<p class="uk-text-meta">Writing to Jira is off — "Do the work" fixes locally and posts nothing; comments and worklogs need <code>allow_writes: true</code> in plugin.jira.settings.yml.</p>`}
  <div id="jira-results" aria-live="polite" hx-get="${esc(resultsUrl)}" hx-trigger="load" hx-swap="innerHTML">
    <p class="uk-text-meta"><span uk-spinner="ratio: .6"></span> Reading the workitems from Jira…</p>
  </div>
</div>`);
    }
    // The three reads do not depend on each other, so they run together: the list, which of its
    // workitems sit in an active sprint (those render FIRST, badged, in the open and mine views), and
    // which screen sessions are up.
    const [out, spOut, screensOut] = await Promise.all([
      run('twg', ['jira', 'workitem', 'query', '--jql', jql, '--limit', '15'], process.env.HOME, { timeoutMs: 60 * 1000 }),
      (!keyAsked && scope !== 'sprint')
        ? run('twg', ['jira', 'workitem', 'query', '--jql',
          `project = ${jiraProject} AND sprint in openSprints() AND statusCategory != Done`, '--limit', '50'],
        process.env.HOME, { timeoutMs: 60 * 1000 })
        : Promise.resolve(null),
      run('screen', ['-ls'], process.env.HOME, { timeoutMs: 10 * 1000 }),
    ]);
    const sprintKeys = new Set<string>();
    if (spOut) {
      try {
        const raw = String(spOut.stdout);
        for (const it of (JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).issues || [])) {
          sprintKeys.add(it.key);
        }
      } catch (_) { /* no sprint ordering, the list still renders */ }
    }
    const screens = String(screensOut.stdout || '');
    // Which live screen session is working this workitem — DERIVED from `screen -ls`,
    // not built from the key. The default name now carries the project as well
    // (`<project>-<key>`), so anything that rebuilt `jira-<key>` from the key stopped
    // finding the session it had just started: the running agent went invisible and
    // "Open the screen" pointed at a name that did not exist. Matching the tail of
    // the real name covers both the old `jira-<key>` sessions and the new ones, and
    // any name a person typed themselves as long as it ends with the workitem.
    //
    // `screen -ls` prints:  \t<pid>.<name>\t(<date>)\t(<state>)
    const screenNames = screens.split('\n')
      .map((l) => (l.match(/^\s*\d+\.(\S+)/) || [])[1]).filter(Boolean) as string[];
    // The same listing as rows, with the state each one is in — what runsFor needs to say which of
    // a workitem's runs is still up. Built once for the page rather than per row.
    const screenRows = screens.split('\n')
      .map((l) => l.match(/^\s*\d+\.(\S+)\s+\([^)]*\)(?:\s+\(([^)]*)\))?/))
      .filter(Boolean).map((m) => ({ session: m[1], state: m[2] || '' })) as { session: string; state: string }[];
    const jiraRuns = runs;
    const agentSession = (k: string): string => {
      const key = k.toLowerCase();
      return screenNames.find((n) => n.toLowerCase() === key
        || n.toLowerCase().endsWith(`-${key}`) || n.toLowerCase().endsWith(`.${key}`)) || '';
    };
    const agentLive = (k: string) => !!agentSession(k);
    const agentLog = (k: string) => fs.existsSync(path.join(workspaceDir(jWs), jName, `.jira-${k}.log`));
    let issues: any[] = [];
    try {
      const raw = String(out.stdout);
      // twg prints a ✓ line before the JSON and a pagination cursor after it.
      issues = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)).issues || [];
    } catch (_) { /* rendered below */ }
    if (sprintKeys.size) issues.sort((a: any, b: any) => Number(sprintKeys.has(b.key)) - Number(sprintKeys.has(a.key)));
    const taskBtn = (kind: string, icon: string, label: string, itKey: string, title?: string) =>
      `<button class="uk-button uk-button-default uk-button-small" title="${esc(title || label)}"
         hx-post="${post('task')}" hx-target="#editor-modal-body" hx-swap="innerHTML"
         hx-vals='{"workspace":"${esc(jWs)}","projectName":"${esc(jName)}","key":"${esc(itKey)}","mode":"${kind}"}'>
         <span uk-icon="icon: ${icon}; ratio: .6"></span> ${esc(label)}</button>`;
    const rows = issues.map((it: any) => `
      <div class="uk-card uk-card-default uk-card-small uk-card-body uk-margin-small jira-card"
           data-find="${esc([it.key, it.summary, it.status?.name, it.issueType?.name, it.assignee?.displayName].filter(Boolean).join(' ').toLowerCase())}">
        <div>${agentLive(it.key) ? `<span class="uk-label uk-label-success agent-live">${iconHtml('tabler:robot-face', 0.8)} agent working</span> ` : ''}${sprintKeys.has(it.key) ? '<span class="uk-label">🏃 active sprint</span> ' : ''}<span class="uk-label${(it.status?.statusCategory?.key === 'indeterminate') ? ' uk-label-warning' : ''}">${esc(it.status?.name || '?')}</span>
          <a href="${esc(it.url || '#')}" target="_blank"><strong>${esc(it.key)}</strong></a>
          ${esc(it.summary || '')}
          <span class="uk-text-meta">· ${esc(it.issueType?.name || '')} · ${esc(it.assignee?.displayName || 'unassigned')}</span></div>
        ${(() => {
          // Every run this workitem has had, not just the one that happens to be up. A workitem is
          // worked more than once — a first pass, a session stopped and started again, a second
          // agent after the first was told something it needed — and `screen -ls` answers only for
          // the ones still running. The finished ones are read from the notes each run writes.
          const runs = jiraRuns.runsFor(it.key, screenRows);
          if (!runs.length) return '';
          return `<div class="uk-margin-small-top jira-runs">
            <span class="uk-text-meta">${runs.length} run${runs.length === 1 ? '' : 's'} of ${esc(it.key)}:</span>
            ${runs.map((r) => `<span class="jira-run${r.live ? ' is-live' : ''}">
              ${r.live
? `<button class="uk-button uk-button-default uk-button-small" type="button" data-open-terminal="${esc(r.session)}"
                     title="Attach a terminal to ${esc(r.session)}"><span uk-icon="icon: laptop; ratio: .6"></span> ${esc(r.session.replace(/^.*--jira-/, ''))}</button>`
: `<code title="${esc(r.session)}">${esc(r.session.replace(/^.*--jira-/, ''))}</code>`}
              ${r.at ? `<span class="uk-text-meta">${esc(humanTime(new Date(r.at)))}</span>` : ''}
              ${r.claude
? `<code class="jira-run-resume" title="Reopen that conversation on this machine — a CLI session is local, it has no page on claude.ai">claude --resume ${esc(r.claude)}</code>`
: '<span class="uk-text-meta" title="No transcript was recorded for this run">no conversation id</span>'}
            </span>`).join('')}
          </div>`;
        })()}
        <div class="uk-margin-small-top">
          ${agentLive(it.key)
            ? `<button class="uk-button uk-button-default uk-button-small" type="button" title="Attach a terminal to the agent's screen session — watch it, answer it, steer it"
                 data-open-terminal="${esc(agentSession(it.key))}">
                 <span uk-icon="icon: laptop; ratio: .6"></span> Open the screen</button>`
            : agentLog(it.key) ? taskBtn('watch', 'play-circle', 'Agent log', it.key, 'The last agent run\'s log') : ''}
          <button class="uk-button uk-button-primary uk-button-small" title="Everything about ${esc(it.key)}: overview, analyze, do the work, runs${allowWrites ? ', comment and worklog' : ''}"
            hx-get="${base}/workitem/${encodeURIComponent(jWs)}/${encodeURIComponent(jName)}/${encodeURIComponent(it.key)}"
            hx-target="#editor-modal-body" hx-swap="innerHTML">
            <span uk-icon="icon: info; ratio: .6"></span> Open</button>
          <button class="uk-button uk-button-default uk-button-small"
            title="Open a new screen with the workitem's prompt ready to edit, then start Claude Code in ${esc(jName)}"
            hx-get="/fragments/screen-new-form?work=${encodeURIComponent(it.key)}&workspace=${encodeURIComponent(jWs)}&project=${encodeURIComponent(jName)}"
            hx-target="#editor-modal-body" hx-swap="innerHTML">
            <span uk-icon="icon: bolt; ratio: .6"></span> Do the work with AI</button>
        </div>
      </div>`).join('');
            return send(`
<div>
  ${(() => {
    // Every agent this project has seen — live or finished — independent of the
    // task filter, so a running screen session is never invisible here.
    let logs: string[] = [];
    try {
      logs = fs.readdirSync(path.join(workspaceDir(jWs), jName))
        .map((f) => f.match(/^\.jira-([A-Z][A-Z0-9]+-[0-9]+)\.log$/)).filter(Boolean).map((m) => m[1]) as string[];
    } catch (_) { /* none */ }
    if (!logs.length) return '';
    const strip = logs.map((k) => {
      const live = agentLive(k);
      const watchBtn = `<button class="uk-button uk-button-${live ? 'primary' : 'default'} uk-button-small"
          title="${live ? 'Live tail of the running agent — follows until it finishes' : 'The full log of the last run'}"
          hx-post="${post('task')}" hx-target="#editor-modal-body" hx-swap="innerHTML"
          hx-vals='{"workspace":"${esc(jWs)}","projectName":"${esc(jName)}","key":"${esc(k)}","mode":"watch"}'>
          <span uk-icon="icon: ${live ? 'play-circle' : 'file-text'}; ratio: .6"></span> ${live ? 'Watch live' : 'Last log'}</button>`;
      return `<div class="uk-margin-small-bottom">${live ? iconHtml('tabler:robot-face', 0.8) : iconHtml('tabler:file-text', 0.8)} <strong>${esc(k)}</strong>
        <span class="uk-label ${live ? 'uk-label-success' : ''}">${live ? 'running' : 'finished'}</span>
        ${watchBtn}
        ${live ? `<span class="uk-text-meta">· reattach in a terminal: <code>ddev ssh</code> then <code>screen -r ${esc(agentSession(k) || `jira-${k.toLowerCase()}`)}</code> (detach again with Ctrl-A D — the agent keeps running)</span>` : ''}
      </div>`;
    }).join('');
    return `<div class="uk-margin-small-bottom"><div class="uk-text-meta">Agents on ${esc(jName)}:</div>${strip}</div>`;
  })()}
  ${issues.length ? rows : (() => {
    // "No open tasks matched" plus 400 bytes of the CLI's own JSON was the whole
    // report, so being SIGNED OUT read as an empty backlog with a stack trace under
    // it. Not signed in is not an empty result: it is one command away from working,
    // and the command is what belongs here.
    const said = String(out.stderr || out.stdout || '');
    // Too old is not an empty backlog either, and it is the reason NOTHING will work until it is
    // dealt with: twg refuses every real command before it looks at the session or the query.
    const stale = twg.twgNoteOutput(said);
    if (stale) {
      return `<div class="msg error"><strong>The Teamwork Graph CLI is out of date.</strong> ${esc(twg.twgUpdateHint(stale))}
        <p class="uk-text-meta">Then reopen this.</p></div>`;
    }
    if (twg.twgNeedsLogin(said)) {
      return `<div class="msg error"><strong>Not signed in to Jira.</strong> ${esc(twg.TWG_LOGIN_HINT)}
        <p class="uk-text-meta">Then reopen this — nothing else needs restarting.</p></div>`;
    }
    return `<div class="msg error">No open tasks matched${out.code !== 0
      ? ` — twg said: <pre>${esc(said.slice(-400))}</pre>` : ''}</div>`;
  })()}
</div>`);
  }

  return { workitem, list };
}
