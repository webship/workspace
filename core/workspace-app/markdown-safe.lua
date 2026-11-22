-- What a markdown file or the assistant's answer says is shown, never run (markdown.mts).
--
-- pandoc's gfm reader keeps embedded HTML as raw HTML even with -raw_html, and the HTML writer writes it
-- out: a CHANGELOG from a checkout, or an answer the assistant was talked into, carried <img onerror=…>
-- or a javascript: link into the dashboard's own origin. Raw HTML becomes text here, and a link or an
-- image keeps its address only when it is http(s), mailto, or a path of this dashboard.

local function safe_url(url)
  -- Browsers drop tabs, newlines and spaces inside a scheme: "java\tscript:" is javascript:.
  local u = string.lower((url or ''):gsub('[%c%s]', ''))
  if u:match('^https?://') or u:match('^mailto:') or u:match('^#') then return url end
  if u:match('^/[^/\\]') or u == '/' then return url end
  -- A relative path ("docs/x.md", "./a"), never "//host" or a scheme of its own.
  if not u:match('^[%a][%w+.-]*:') and not u:match('^[/\\][/\\]') then return url end
  return '#'
end

function RawInline(el) return pandoc.Str(el.text) end
function RawBlock(el) return pandoc.CodeBlock(el.text) end
function Link(el) el.target = safe_url(el.target); return el end
function Image(el) el.src = safe_url(el.src); return el end
