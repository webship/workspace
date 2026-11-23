// Built from src/browser by `npm run build:browser`: edit the .ts source there, not this file.
"use strict";
(function() {
  "use strict";
  var data = null;
  var overlay = null;
  var input = null;
  var list = null;
  var live = null;
  var items = [];
  var active = 0;
  var returnTo = null;
  var chord = 0;
  var CHORDS = {
    h: ["home", "Home"],
    d: ["dev", "Dev"],
    t: ["test", "Test"],
    p: ["products", "Products"],
    x: ["sandboxes", "Sandboxes"],
    e: ["demos", "Demos"],
    r: ["projects", "Projects"],
    v: ["videos", "Videos"],
    a: ["audio", "Audio"],
    o: ["docs", "Docs"],
    m: ["modules", "Modules"],
    w: ["worklogs", "Worklogs"],
    s: ["/screens", "Screens"],
    c: ["/commands", "Commands"],
    ",": ["/settings", "Settings"],
    "?": ["/help", "Help"]
  };
  function typing(e) {
    var t = e.composedPath && e.composedPath()[0] || e.target;
    if (!t || !t.tagName) return false;
    var n = t.tagName.toLowerCase();
    return n === "input" || n === "textarea" || n === "select" || n === "deep-chat" || t.isContentEditable || !!(t.closest && t.closest(".ace_editor, .xterm"));
  }
  function modalOpen() {
    return !!document.querySelector("#editor-modal.uk-open, #confirm-modal.uk-open");
  }
  function score(text, q) {
    text = text.toLowerCase();
    if (!q) return 1;
    if (text === q) return 100;
    if (text.indexOf(q) === 0) return 80;
    if (text.indexOf(q) > 0) return 60 - Math.min(40, text.indexOf(q));
    var i = 0;
    for (var k = 0; k < text.length && i < q.length; k += 1) if (text[k] === q[i]) i += 1;
    return i === q.length ? 20 : 0;
  }
  function hubUrl(key) {
    if (key === "home") {
      var parts = location.hostname.split(".");
      var k = parts.findIndex(function(_, i) {
        return data && data.workspaces.some(function(w2) {
          return w2.key === parts[i];
        });
      });
      return location.protocol + "//" + (k >= 0 ? parts.slice(k + 1).join(".") : location.hostname) + (location.port ? ":" + location.port : "") + "/";
    }
    var w = data && data.workspaces.find(function(x) {
      return x.key === key;
    });
    return w ? w.url : null;
  }
  function density(value) {
    var btn = document.querySelector('.density-pick[data-density="' + value + '"]');
    if (btn) {
      btn.click();
      return;
    }
    document.documentElement.dataset.density = value;
    if (window.wsPrefSet) window.wsPrefSet("ws-density", value);
  }
  function actions() {
    return [
      { group: "Do", label: "New screen", hint: "A shell, Claude Code or a command, detached", run: function() {
        close();
        if (window.htmx) window.htmx.ajax("GET", "/fragments/screen-new-form" + (location.hostname.split(".")[0] ? "" : ""), { target: "#editor-modal-body", swap: "innerHTML" });
      } },
      { group: "Do", label: "Switch light and dark", hint: "The theme toggle", run: function() {
        close();
        var t = document.querySelector("[data-theme-toggle], #theme-toggle, .theme-toggle");
        if (t) t.click();
      } },
      { group: "Do", label: "Rows: compact", hint: "Project buttons without the caption under each", run: function() {
        close();
        density("compact");
      } },
      { group: "Do", label: "Rows: comfortable", hint: "Project buttons with their captions", run: function() {
        close();
        density("comfortable");
      } },
      { group: "Do", label: "Show the keyboard shortcuts", hint: "?", run: function() {
        render("?");
      } }
    ];
  }
  function build(q) {
    var out = [];
    var d = data;
    if (!d) return out;
    var query = q.trim().toLowerCase();
    var add = function(group, label, hint, url, extra) {
      var s = Math.max(score(label, query), extra ? score(extra, query) - 10 : 0);
      if (s > 0) out.push({ group, label, hint, url, score: s });
    };
    add("Go to", "Home", "All workspaces", hubUrl("home"));
    d.workspaces.forEach(function(w) {
      add("Go to", w.label, w.key + (w.kind === "files" ? " · files" : ""), w.url, w.key);
    });
    d.pages.forEach(function(p) {
      add("Go to", p.label, p.hint, p.url);
    });
    if (query) {
      var shown = 0;
      d.projects.forEach(function(p) {
        if (shown >= 40) return;
        var s = score(p.name, query);
        if (s > 0) {
          out.push({ group: "Projects", label: p.name, hint: p.ws + (p.site ? " · open the site" : " · open the workspace"), url: p.url, score: s });
          shown += 1;
        }
      });
    }
    actions().forEach(function(a) {
      var s = score(a.label, query);
      if (s > 0) out.push({ group: a.group, label: a.label, hint: a.hint, run: a.run, score: s - 5 });
    });
    if (query && out.some(function(x) {
      return x.score >= 40;
    })) out = out.filter(function(x) {
      return x.score >= 40;
    });
    out.sort(function(a, b) {
      return b.score - a.score;
    });
    var order = { "Go to": 0, Projects: 1, Do: 2 };
    var grouped = out.slice(0, 40);
    grouped.sort(function(a, b) {
      return (order[a.group] ?? 0) - (order[b.group] ?? 0) || b.score - a.score;
    });
    return grouped;
  }
  function sheet() {
    var rows = [["Ctrl or Cmd + K, or /", "Open this palette"], ["?", "This sheet"], ["Esc", "Close"]];
    Object.keys(CHORDS).forEach(function(k) {
      var c = CHORDS[k];
      if (!c) return;
      var chordTo = c[0];
      var exists = c[0].charAt(0) === "/" || c[0] === "home" || data && data.workspaces.some(function(w) {
        return w.key === chordTo;
      });
      if (exists) rows.push(["g " + k, c[1]]);
    });
    return rows;
  }
  function render(q) {
    if (!list || !input) return;
    var ul = list;
    var box = input;
    list.textContent = "";
    if (q === "?") {
      var h = document.createElement("li");
      h.className = "palette-group";
      h.setAttribute("role", "presentation");
      h.textContent = "Keyboard shortcuts";
      ul.appendChild(h);
      sheet().forEach(function(r) {
        var li = document.createElement("li");
        li.className = "palette-row palette-shortcut";
        li.setAttribute("role", "presentation");
        var k = document.createElement("kbd");
        k.textContent = r[0];
        var s = document.createElement("span");
        s.textContent = r[1];
        li.appendChild(k);
        li.appendChild(s);
        ul.appendChild(li);
      });
      items = [];
      active = -1;
      box.removeAttribute("aria-activedescendant");
      announce("Keyboard shortcuts");
      return;
    }
    items = build(q);
    active = items.length ? 0 : -1;
    var last = "";
    items.forEach(function(it, i) {
      if (it.group !== last) {
        var g = document.createElement("li");
        g.className = "palette-group";
        g.setAttribute("role", "presentation");
        g.textContent = it.group;
        ul.appendChild(g);
        last = it.group;
      }
      var li = document.createElement("li");
      li.id = "palette-opt-" + i;
      li.className = "palette-row";
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === active ? "true" : "false");
      var l = document.createElement("span");
      l.className = "palette-label";
      l.textContent = it.label;
      var m = document.createElement("span");
      m.className = "palette-hint";
      m.textContent = it.hint || "";
      li.appendChild(l);
      li.appendChild(m);
      li.addEventListener("mousemove", function() {
        move(i, true);
      });
      li.addEventListener("click", function() {
        choose(i);
      });
      ul.appendChild(li);
    });
    if (!items.length) {
      var e = document.createElement("li");
      e.className = "palette-empty";
      e.setAttribute("role", "presentation");
      e.textContent = "Nothing matches “" + q + "”.";
      ul.appendChild(e);
    }
    if (active >= 0) box.setAttribute("aria-activedescendant", "palette-opt-" + active);
    else box.removeAttribute("aria-activedescendant");
    announce(items.length ? items.length + (items.length === 1 ? " result" : " results") : "No results");
  }
  function announce(t) {
    if (live) live.textContent = t;
  }
  function move(i, noScroll) {
    if (!items.length || !list || !input) return;
    active = (i + items.length) % items.length;
    list.querySelectorAll("[role=option]").forEach(function(el2, k) {
      el2.setAttribute("aria-selected", k === active ? "true" : "false");
    });
    input.setAttribute("aria-activedescendant", "palette-opt-" + active);
    var el = document.getElementById("palette-opt-" + active);
    if (el && !noScroll) el.scrollIntoView({ block: "nearest" });
  }
  function choose(i) {
    var it = items[i];
    if (!it) return;
    if (it.run) {
      it.run();
      return;
    }
    close();
    if (it.url) location.href = it.url;
  }
  function inertOthers(on) {
    Array.prototype.forEach.call(document.body.children, function(el) {
      if (el === overlay || el.tagName === "SCRIPT" || el.contains(overlay)) return;
      if (on) {
        if (!("palWasInert" in el.dataset)) el.dataset.palWasInert = el.inert ? "1" : "";
        el.inert = true;
      } else if ("palWasInert" in el.dataset) {
        el.inert = el.dataset.palWasInert === "1";
        delete el.dataset.palWasInert;
      }
    });
  }
  function ensure() {
    if (overlay) return;
    var o = document.createElement("div");
    overlay = o;
    o.id = "palette";
    o.hidden = true;
    o.innerHTML = '<div class="palette-dialog" role="dialog" aria-modal="true" aria-label="Command palette"><input class="palette-input" type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" placeholder="Go to a workspace, a project or a page…" aria-label="Go to"><ul id="palette-list" class="palette-list" role="listbox" aria-label="Results"></ul><div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span><span><kbd>?</kbd> shortcuts</span></div><div class="palette-live uk-hidden-visually" aria-live="polite"></div></div>';
    document.body.appendChild(o);
    const field = o.querySelector(".palette-input");
    input = field;
    list = o.querySelector(".palette-list");
    live = o.querySelector(".palette-live");
    o.addEventListener("mousedown", function(e) {
      if (e.target === overlay) close();
    });
    if (!field) return;
    field.addEventListener("input", function() {
      render(field.value);
    });
    field.addEventListener("keydown", function(e) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(active + 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move(active - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(active);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Tab") {
        e.preventDefault();
      }
    });
  }
  function open(initial) {
    ensure();
    returnTo = document.activeElement;
    var go = function() {
      if (!overlay || !input) return;
      overlay.hidden = false;
      inertOthers(true);
      input.value = initial === "?" ? "" : initial || "";
      render(initial === "?" ? "?" : input.value);
      input.focus();
    };
    if (data) {
      go();
      return;
    }
    fetch("/fragments/palette.json", { credentials: "same-origin" }).then(function(r) {
      return r.json();
    }).then(function(d) {
      data = d;
      go();
    }).catch(function() {
      data = { workspaces: [], pages: [], projects: [] };
      go();
    });
  }
  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    inertOthers(false);
    if (returnTo instanceof HTMLElement) {
      try {
        returnTo.focus();
      } catch (_) {
      }
    }
  }
  document.addEventListener("click", function(e) {
    var t = e.target instanceof Element && e.target.closest(".palette-trigger");
    if (t) {
      e.preventDefault();
      open("");
    }
  });
  if (/Mac|iPhone|iPad/.test(navigator.platform || "")) {
    document.querySelectorAll(".palette-trigger-key").forEach(function(k) {
      k.textContent = "⌘K";
    });
  }
  document.addEventListener("keydown", function(e) {
    if (e.defaultPrevented) return;
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && k.toLowerCase() === "k") {
      e.preventDefault();
      if (overlay && !overlay.hidden) close();
      else open("");
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (overlay && !overlay.hidden) return;
    if (typing(e) || modalOpen()) return;
    if (chord && Date.now() - chord < 1200) {
      chord = 0;
      var c = CHORDS[k.toLowerCase()];
      if (c) {
        e.preventDefault();
        var to = c[0];
        var url = to.charAt(0) === "/" ? to : hubUrl(to);
        if (url) {
          location.href = url;
          return;
        }
        fetch("/fragments/palette.json", { credentials: "same-origin" }).then(function(r) {
          return r.json();
        }).then(function(d) {
          data = d;
          var u = hubUrl(to);
          if (u) location.href = u;
        });
      }
      return;
    }
    if (k === "/") {
      e.preventDefault();
      open("");
      return;
    }
    if (k === "?") {
      e.preventDefault();
      open("?");
      return;
    }
    if (k === "g") {
      chord = Date.now();
    }
  });
})();
