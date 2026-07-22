/* Tiny progressive-enhancement layer on top of HTMX (no frameworks, no modals). */

// Two-step arm/confirm for destructive Remove buttons: first click arms the
// button (no browser confirm() dialog), second click within 5s fires the
// HTMX request via the custom 'confirmed-remove' trigger.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.arm-step');
  if (!btn) return;
  if (btn.dataset.armed !== '1') {
    e.preventDefault();
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = '⚠️ Sure?';
    btn.classList.add('arm');
    setTimeout(() => {
      btn.dataset.armed = '0';
      btn.textContent = btn.dataset.label || '🗑️ Remove';
      btn.classList.remove('arm');
    }, 5000);
    return;
  }
  btn.dataset.armed = '0';
  btn.textContent = btn.dataset.label || '🗑️ Remove';
  btn.classList.remove('arm');
  window.htmx && window.htmx.trigger(btn, 'confirmed-remove');
});

// Keep the chat log scrolled to the latest message after every HTMX swap.
document.addEventListener('htmx:afterSwap', (e) => {
  const log = document.getElementById('chat-log');
  if (log && (e.target === log || log.contains(e.target))) {
    log.scrollTop = log.scrollHeight;
  }
});
