// The guide: search keeps the sections that hold every word and marks the hits; the contents follow
// the section you are reading.
(function helpPage() {
  const page = document.querySelector('.help-layout');
  if (!page) return;
  const sections = [...page.querySelectorAll('.help-section')];
  const clearMarks = () => page.querySelectorAll('mark.help-hit').forEach((m) => m.replaceWith(document.createTextNode(m.textContent)));
  const mark = (root, word) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const i = n.nodeValue.toLowerCase().indexOf(word);
      if (i >= 0 && !n.parentElement.closest('pre, code, mark')) hits.push([n, i]);
    }
    hits.forEach(([n, i]) => {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + word.length);
      const m = document.createElement('mark'); m.className = 'help-hit'; r.surroundContents(m);
    });
  };
  page.querySelector('.help-find').addEventListener('input', (e) => {
    clearMarks();
    page.querySelectorAll('.help-section').forEach((s) => s.normalize());
    const words = e.target.value.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    let shown = 0;
    sections.forEach((s) => {
      const on = words.every((w) => s.textContent.toLowerCase().includes(w));
      s.hidden = !on;
      const link = page.querySelector(`[data-help-toc="${CSS.escape(s.dataset.helpSection)}"]`);
      if (link) link.parentElement.hidden = !on;
      if (on) { shown += 1; if (words.length) words.forEach((w) => mark(s, w)); }
    });
    page.querySelector('.help-none').hidden = shown > 0;
  });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.filter((x) => x.isIntersecting).forEach((x) => {
        page.querySelectorAll('[data-help-toc]').forEach((a) => a.classList.toggle('is-current', a.dataset.helpToc === x.target.dataset.helpSection));
      });
    }, { rootMargin: '-20% 0px -70% 0px' });
    sections.forEach((s) => io.observe(s));
  }
})();

// Help for the page you are on: a "?" beside the page heading opens the guide at the part about it.
(function pageHelpLink() {
  const where = document.documentElement.dataset.help;
  const head = document.querySelector('.page-heading');
  if (!where || !head || head.querySelector('.page-help')) return;
  const a = document.createElement('a');
  a.className = 'page-help';
  a.href = `/help#${where}`;
  a.title = 'How this page works, in the guide';
  a.setAttribute('aria-label', 'Help for this page');
  a.textContent = '?';
  // Before the width switcher, which is last in the heading and drawn last: appended after it, the "?" was
  // drawn before it and reached after it (WCAG 2.4.3).
  head.insertBefore(a, head.querySelector(':scope > .width-switcher'));
})();

// The guide's code blocks are what people come to copy, so each one has a Copy button.
document.querySelectorAll('.help-body pre').forEach((pre) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'help-copy';
  b.textContent = 'Copy';
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(pre.innerText.replace(/\nCopy$/, '')); b.textContent = 'Copied'; }
    catch (_) { b.textContent = 'Select and copy'; }
    setTimeout(() => { b.textContent = 'Copy'; }, 1600);
  });
  pre.classList.add('has-copy');
  pre.appendChild(b);
});

