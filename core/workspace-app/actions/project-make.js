/**
 * Make a video or an audio recording about a project: the form of the row's More menu posts here.
 * It starts a Claude Code session in the project through the same handler New screen uses, briefed by
 * `project-make.js`, so it shows on Screens like every other session.
 */

const { esc } = require('../html');
const make = require('../project-make');

async function project_make({ form, send, res }) {
  const brief = make.brief(form);
  if (brief.error) return send(`<div class="msg error">${esc(brief.error)}</div>`, 400);
  let out = null;
  await require('./screens')['/actions/screen-new']({
    form: { target: brief.target, kind: 'claude', session: brief.session, command: brief.prompt },
    send: (html, status = 200) => { out = { html, status }; },
    res,
  });
  if (!out || out.status >= 400) return send((out && out.html) || '<div class="msg error">The session did not start.</div>', (out && out.status) || 500);
  const name = `${brief.project ? `${brief.ws}--${brief.project}` : brief.ws}--${brief.session}`.toLowerCase();
  const dest = make.KIND[brief.kind].dest;
  return send(`<div class="msg assistant">
      <p>The AI (Claude Code) is working${brief.project ? ` in <strong>${esc(brief.ws)}/${esc(brief.project)}</strong>` : ''}, in the session <code>${esc(name)}</code>.</p>
      <p class="uk-text-meta">It writes the words first and waits for your yes. Watch and answer it on <a href="/screens">Screens</a>, or
        <code>screen -r ${esc(name)}</code> in your terminal. The result lands in <a href="https://${esc(dest)}.${esc(require('../workspaces').hubDomain())}">${esc(dest)}</a>.</p></div>`);
}

module.exports = { '/actions/project-make': project_make };
