/* ---------------- the New screen form ------------------------------------- */

// Which fieldsets belong to which kind of session. The kind is a radio now rather than a select: three
// named choices with a line each read better than three words in a dropdown, and the thing being chosen
// changes what the rest of the form asks.
window.screenKindChanged = function screenKindChanged(form) {
  if (!form) return;
  const kind = (form.querySelector('input[name="kind"]:checked') || {}).value || 'shell';
  for (const el of form.querySelectorAll('[data-claude-only]')) el.hidden = kind !== 'claude';
  for (const el of form.querySelectorAll('[data-not-claude]')) el.hidden = kind === 'claude';
  for (const label of form.querySelectorAll('.screen-kind')) {
    label.classList.toggle('is-on', (label.querySelector('input') || {}).checked === true);
  }
};

// The session name follows where it runs, until somebody types their own. It is the first thing
// `screen -ls` shows and what `screen -r` takes, so the answer is almost always the place — but a name
// that overwrote what was typed would be worse than no default at all.
window.screenNameFollowsTarget = function screenNameFollowsTarget(form) {
  if (!form) return;
  const field = form.querySelector('input[name="session"]');
  const target = form.querySelector('select[name="target"]');
  if (!field || !target) return;
  // The same shape the server fills in: where it runs, then a short id so a second session in the same
  // place is not refused as a name that already exists. The id is kept while only the place changes, so
  // watching the name settle does not look like a slot machine.
  const tail = field.dataset.tail || (field.dataset.tail = Math.random().toString(16).slice(2, 6));
  const value = String(target.value || '');
  const derived = (value === 'root'
    ? `workspace-${tail}`
    : `${value.replace(/^p:([a-z0-9_-]+):(.+)$/, '$1--$2').replace(/^ws:/, '')}--${tail}`)
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/-{3,}/g, '--').slice(0, 60);
  const path = (target.selectedOptions[0] || {}).dataset;
  const line = form.querySelector('.screen-where-path code');
  if (line && path && path.path) line.textContent = path.path;
  if (field.value && field.value !== field.dataset.derived) return;   // typed by hand: leave it alone
  field.value = derived;
  field.dataset.derived = derived;
};

// A prompt template fills the prompt and brings its own flags along, so the session runs the command
// that prompt file documents. The flags land on the controls that own them rather than in a text box.
window.screenPromptTemplate = function screenPromptTemplate(select) {
  const form = select.form;
  if (!select.value || !form) return;
  const flags = (select.selectedOptions[0].dataset.flags || '').trim();
  const tokens = flags.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i].startsWith('--')) continue;
    const field = form.querySelector(`[name="arg_${tokens[i].replace(/^--/, '').replace(/[^A-Za-z0-9]+/g, '_')}"]`);
    if (!field) continue;
    const next = tokens[i + 1];
    if (field.type === 'checkbox') { field.checked = true; continue; }
    if (next && !next.startsWith('--')) { field.value = next; i += 1; }
  }
  fetch(`/fragments/prompt-text/${encodeURIComponent(select.value)}`)
    .then((r) => r.text())
    .then((t) => {
      const text = t.trim();
      const field = form.querySelector('textarea[name="command"]');
      if (!field) return;
      field.value = text;
      if (field._aceEditor) { field._aceEditor.session.setValue(text); field._aceEditor.focus(); } else field.focus();
    });
};

// The form arrives in the editor modal, and its "where it runs" half is swapped again whenever the
// workspace changes — so both the kind toggle and the name default are settled here rather than from an
// inline handler on an element the swap may have replaced.
document.body.addEventListener('htmx:after:settle', (e) => {
  const el = e.target;
  if (!el || !el.querySelector) return;
  const kinds = el.querySelector('form .screen-kinds') || (el.closest && el.closest('form') && el.matches('.screen-kinds') ? el : null);
  if (kinds) window.screenKindChanged(kinds.closest('form'));
  const where = el.id === 'screen-where' ? el : el.querySelector('#screen-where');
  if (where && where.closest('form')) window.screenNameFollowsTarget(where.closest('form'));
});

