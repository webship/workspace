/* ---------------- the name the Build form proposes ---------------- */
//
// Choosing a builder fills the name field with something derived from what it builds, numbered past
// what is already in that folder — `byte1`, then `byte2` — because a form that says only
// `new-project-name` is how a tree ends up holding `my-drupal-site`, `my-drupal-site-pulse` and
// `my-drupal-site-pulse2`.
//
// The one rule: a name somebody TYPED is never overwritten. The field is filled only while it is
// empty, or while it still holds the exact suggestion this code last put there — so changing the
// dropdown re-proposes, and changing it after typing leaves the typing alone.
(function () {
  let lastSuggested = '';
  document.body.addEventListener('suggest-project-name', (e) => {
    const name = typeof e.detail === 'string' ? e.detail : (e.detail && e.detail.value);
    if (!name) return;
    document.querySelectorAll('input[data-suggest-name]').forEach((input) => {
      const now = input.value.trim();
      if (now !== '' && now !== lastSuggested) return;   // theirs, not ours
      input.value = name;
    });
    lastSuggested = name;
  });
})();

// Who is signed in, when the dashboard asks for Google sign-in: the name and a way out. With sign-in off
// /auth/me says so and nothing is drawn.
(function () {
  var slot = document.getElementById('auth-user');
  if (!slot || !window.fetch) return;
  fetch('/auth/me', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
    if (!u || !u.enabled || !u.email) return;
    slot.textContent = '';
    var who = document.createElement('span');
    who.textContent = u.name || u.email;
    who.title = u.email;
    var out = document.createElement('a');
    out.href = '/auth/signout';
    out.textContent = 'Sign out';
    out.className = 'uk-margin-small-left';
    slot.appendChild(who);
    slot.appendChild(out);
    slot.hidden = false;
  }).catch(function () {});
})();

// The image viewer: fit or actual size, and the arrow keys step through the list it was opened from.
document.addEventListener('click', (e) => {
  const btn = e.target && e.target.closest ? e.target.closest('[data-img-zoom]') : null;
  if (!btn) return;
  const stage = btn.closest('[data-img-viewer]') && btn.closest('[data-img-viewer]').querySelector('[data-img-stage]');
  if (!stage) return;
  const fit = stage.classList.toggle('is-fit');
  btn.textContent = fit ? 'Actual size' : 'Fit';
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const viewer = document.querySelector('#editor-modal.uk-open [data-img-viewer]');
  if (!viewer || e.target.closest('input, textarea, select, [contenteditable]')) return;
  const btn = viewer.querySelector(e.key === 'ArrowLeft' ? '[data-img-prev]' : '[data-img-next]');
  if (!btn) return;
  e.preventDefault();
  btn.click();
});

// Upload images: each file is its own request with its bytes as the body, then the gallery refreshes.
async function uploadImages(box, files) {
  const log = box.querySelector('[data-img-upload-log]');
  const folder = (box.querySelector('[data-img-upload-folder]') || {}).value || '';
  for (const f of files) {
    const li = document.createElement('li');
    li.textContent = `${f.name}…`;
    log.appendChild(li);
    try {
      const r = await fetch(`/actions/image-upload?path=${encodeURIComponent(folder)}&name=${encodeURIComponent(f.name)}`,
        { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
      li.innerHTML = await r.text();
    } catch (err) {
      li.textContent = `${f.name}: ${err.message}`;
    }
  }
  if (window.htmx) htmx.trigger(document.body, 'refresh-projects');
}
document.addEventListener('change', (e) => {
  const input = e.target && e.target.matches && e.target.matches('[data-img-upload-input]') ? e.target : null;
  if (input && input.files.length) uploadImages(input.closest('[data-img-upload]'), [...input.files]);
});
['dragover', 'dragleave', 'drop'].forEach((type) => document.addEventListener(type, (e) => {
  const zone = e.target && e.target.closest ? e.target.closest('[data-img-drop]') : null;
  if (!zone) return;
  e.preventDefault();
  zone.classList.toggle('is-over', type === 'dragover');
  if (type === 'drop' && e.dataTransfer.files.length) uploadImages(zone.closest('[data-img-upload]'), [...e.dataTransfer.files]);
}));

// Choosing a DDEV quickstart fills the fields beside it; each can still be changed.
document.addEventListener('change', (e) => {
  const sel = e.target && e.target.closest ? e.target.closest('select[data-ddev-preset]') : null;
  if (!sel) return;
  const o = sel.selectedOptions[0];
  const box = sel.closest('.ddev-options');
  if (!o || !o.value || !box) return;
  ['project_type', 'php_version', 'database', 'webserver_type'].forEach((k) => {
    const f = box.querySelector(`[name="${k}"]`);
    const v = o.dataset[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
    if (f && v !== undefined) f.value = v;
  });
  const root = box.querySelector('[name="docroot"]');
  if (root) root.value = o.dataset.docroot === '__default' ? '' : (o.dataset.docroot || '');
  const omit = box.querySelector('[name="omit_db"]');
  if (omit) omit.checked = o.dataset.omitDb === '1';
  const py = box.querySelector('[name="python"]');
  if (py) py.checked = o.dataset.python === '1';
});

// Deleting a workspace: Enter in a step's field answers that step instead of submitting the settings form around it.
document.addEventListener('keydown', (e) => {
  const field = e.key === 'Enter' && e.target.closest && e.target.closest('.ws-delete-step input');
  if (!field) return;
  e.preventDefault();
  const go = field.closest('.ws-delete-step').querySelector('.ws-delete-go');
  if (go) go.click();
});
// Focus the step's field after the swap, and again once the confirm dialog has closed, which hands focus to the body.
const focusWsDeleteStep = () => {
  const field = document.querySelector('.ws-delete-step input');
  if (field && document.activeElement !== field) field.focus();
};
document.body.addEventListener('htmx:after:swap', focusWsDeleteStep);
document.addEventListener('hidden', (e) => { if (e.target && e.target.id === 'confirm-modal') setTimeout(focusWsDeleteStep, 0); }, true);
