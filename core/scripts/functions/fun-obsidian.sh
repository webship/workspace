#!/usr/bin/env bash

# Turn a project's knowledge graph into an Obsidian vault.
#
# The graph is already the hard part: `graphify` parses the code and writes
# graphs/<workspace>/<project>/graph.json — the entities and the relations between
# them. Obsidian is a reader for exactly that shape, so this converts rather than
# re-parses. Parsing the tree a second time would cost the same minutes again and
# could disagree with the graph the rest of the menu shows.
#
# What it writes, next to the graph in graphs/<workspace>/<project>/obsidian/:
#
#   <project>.md          the index — every entity, grouped by the cluster graphify found
#   notes/<entity>.md     one note per node: frontmatter, then a [[wikilink]] per relation
#   <project>.canvas      JSON Canvas 1.0, so Obsidian's Canvas opens the actual map
#   .obsidian/            enough config that Obsidian opens the vault without asking
#
# The wikilinks are the point. Obsidian builds its own graph view, backlinks and
# unlinked-mentions from them, so a graph that was a static picture becomes something
# you can walk — and the notes are plain markdown, readable without Obsidian at all.
#
# JSON Canvas 1.0: https://jsoncanvas.org/spec/1.0/

# Where a project's vault lives: inside its graph store, because it is made from the
# graph and is thrown away with it.
function obsidian_vault_dir() {
  printf '%s' "${WORKSPACE_ROOT}/graphs/${1}/${2}/obsidian";
}

# Build the vault from the graph.
function obsidian_project() {
  local ws="${doc_name}" project="${PROJECT_NAME}";
  local store="${WORKSPACE_ROOT}/graphs/${ws}/${project}";
  local graph="${store}/graph.json";
  local vault; vault=$(obsidian_vault_dir "${ws}" "${project}");

  if [ ! -f "${graph}" ] ; then
    echo "No graph for ${ws}/${project} yet." ;
    echo "Build one first:  bash cmd-tools-graphify.sh ${project}" ;
    return 1 ;
  fi

  if ! command -v python3 > /dev/null 2>&1 ; then
    echo "python3 is needed to read the graph — not found." ;
    return 1 ;
  fi

  echo "*---------------------------------------------------------------------*";
  echo "  Obsidian vault for ${ws}/${project}";
  echo "*---------------------------------------------------------------------*";
  echo "  graph   ${graph}";
  echo "  vault   ${vault}";
  echo "";

  # Written to a sibling directory and swapped in, so an interrupted run never leaves
  # a half-written vault where Obsidian would open it.
  local tmp="${vault}.building";
  rm -rf "${tmp}" ;
  mkdir -p "${tmp}" ;

  if ! MAX_CANVAS_NODES="${MAX_CANVAS_NODES:-300}" python3 - "${graph}" "${tmp}" "${project}" "${ws}" <<'PYEOF'
import json, os, re, sys, unicodedata
from collections import defaultdict

graph_path, out, project, workspace = sys.argv[1:5]
max_canvas = int(os.environ.get('MAX_CANVAS_NODES', '300'))

with open(graph_path, encoding='utf-8') as fh:
    graph = json.load(fh)

nodes = graph.get('nodes') or []
links = graph.get('links') or []

if not nodes:
    print('  The graph has no nodes — nothing to write.')
    sys.exit(2)

# ---------------------------------------------------------------- note names
# A node id is whatever the parser found: it can carry /, :, #, characters Windows
# refuses and characters Obsidian reads as link syntax. Sanitise, then de-duplicate,
# because two different ids can flatten to the same name and a collision would make
# one note silently overwrite the other.
ILLEGAL = re.compile(r'[\\/:*?"<>|\[\]#^]+')

def note_name(raw):
    name = unicodedata.normalize('NFC', str(raw)).strip()
    name = ILLEGAL.sub('-', name).strip(' .-')
    return name[:120] or 'unnamed'

names, taken = {}, {}
for n in nodes:
    nid = n.get('id')
    if nid is None:
        continue
    base = note_name(n.get('label') or nid)
    key = base.lower()
    if key in taken:
        taken[key] += 1
        base = f'{base} ({taken[key]})'
    else:
        taken[key] = 1
    names[nid] = base

# --------------------------------------------------------------------- edges
out_edges = defaultdict(list)
in_edges = defaultdict(list)
for e in links:
    s, t = e.get('source'), e.get('target')
    if s in names and t in names:
        rel = str(e.get('relation') or 'relates to')
        out_edges[s].append((t, rel))
        in_edges[t].append((s, rel))

by_id = {n['id']: n for n in nodes if n.get('id') in names}

def yaml_str(v):
    s = str(v).replace('"', "'")
    return f'"{s}"'

# --------------------------------------------------------------------- notes
notes_dir = os.path.join(out, 'notes')
os.makedirs(notes_dir, exist_ok=True)

for nid, name in names.items():
    n = by_id[nid]
    fm = ['---']
    fm.append(f'title: {yaml_str(n.get("label") or nid)}')
    tags = ['graphify']
    ftype = n.get('file_type')
    if ftype:
        tags.append(re.sub(r'[^a-z0-9_-]+', '-', str(ftype).lower()))
    fm.append('tags: [' + ', '.join(tags) + ']')
    if n.get('source_file'):
        fm.append(f'source_file: {yaml_str(n["source_file"])}')
    if n.get('source_location'):
        fm.append(f'source_location: {yaml_str(n["source_location"])}')
    if n.get('community') is not None:
        fm.append(f'cluster: {n["community"]}')
    fm.append(f'project: {yaml_str(project)}')
    fm.append(f'workspace: {yaml_str(workspace)}')
    fm.append('---')

    body = [f'# {n.get("label") or nid}', '']
    where = n.get('source_file')
    if where:
        loc = n.get('source_location')
        body.append(f'`{where}`' + (f' — {loc}' if loc else ''))
        body.append('')

    outs = sorted(out_edges.get(nid, []), key=lambda x: (x[1], names[x[0]]))
    if outs:
        body.append('## Points at')
        body.append('')
        for tgt, rel in outs:
            body.append(f'- {rel} → [[{names[tgt]}]]')
        body.append('')

    ins = sorted(in_edges.get(nid, []), key=lambda x: (x[1], names[x[0]]))
    if ins:
        # Obsidian computes backlinks itself, but only from links that exist in the
        # text. Writing the incoming side too means the relation is readable from
        # either end, and it survives being read outside Obsidian.
        body.append('## Pointed at by')
        body.append('')
        for src, rel in ins:
            body.append(f'- [[{names[src]}]] → {rel}')
        body.append('')

    body.append(f'---')
    body.append(f'Part of [[{project}]].')

    with open(os.path.join(notes_dir, f'{name}.md'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(fm) + '\n\n' + '\n'.join(body) + '\n')

# --------------------------------------------------------------------- index
clusters = defaultdict(list)
for nid, name in names.items():
    clusters[by_id[nid].get('community', 0)].append(name)

index = ['---', f'title: {yaml_str(project)}', 'tags: [graphify, index]', '---', '',
         f'# {project}', '',
         f'The knowledge graph of `{workspace}/{project}`, as notes: '
         f'**{len(names)} entities**, **{len(links)} relations**, '
         f'in **{len(clusters)} clusters**.', '',
         f'Open `{project}.canvas` for the map. Every note links to what it points at, so '
         'Obsidian\'s own graph view, backlinks and unlinked mentions all work.', '']
for c in sorted(clusters, key=lambda k: (str(type(k)), k)):
    index.append(f'## Cluster {c}')
    index.append('')
    for name in sorted(clusters[c]):
        index.append(f'- [[{name}]]')
    index.append('')
with open(os.path.join(out, f'{note_name(project)}.md'), 'w', encoding='utf-8') as fh:
    fh.write('\n'.join(index))

# -------------------------------------------------------------------- canvas
# JSON Canvas 1.0. Laid out deterministically — grid within cluster, clusters in a
# grid — because the vault is stored and a random layout would diff in full on
# every rebuild.
NODE_W, NODE_H, GAP_X, GAP_Y = 260, 60, 320, 110
PRESET = ['1', '2', '3', '4', '5', '6']

ranked = sorted(names, key=lambda i: (-len(out_edges.get(i, [])) - len(in_edges.get(i, [])), names[i]))
shown = ranked[:max_canvas]
shown_set = set(shown)

canvas_nodes, canvas_edges, canvas_id = [], [], {}
grouped = defaultdict(list)
for nid in shown:
    grouped[by_id[nid].get('community', 0)].append(nid)

cluster_x = 0
for ci, c in enumerate(sorted(grouped, key=lambda k: str(k))):
    members = sorted(grouped[c], key=lambda i: names[i])
    cols = max(1, int(len(members) ** 0.5))
    for i, nid in enumerate(members):
        cid = f'n{len(canvas_nodes)}-{re.sub(r"[^A-Za-z0-9]", "", str(nid))[:24] or "x"}'
        canvas_id[nid] = cid
        canvas_nodes.append({
            'id': cid,
            'type': 'file',
            'file': f'notes/{names[nid]}.md',
            'x': cluster_x + (i % cols) * GAP_X,
            'y': (i // cols) * GAP_Y,
            'width': NODE_W,
            'height': NODE_H,
            'color': PRESET[ci % len(PRESET)],
        })
    cluster_x += cols * GAP_X + GAP_X

for e in links:
    s, t = e.get('source'), e.get('target')
    if s in shown_set and t in shown_set:
        canvas_edges.append({
            'id': f'e{len(canvas_edges)}',
            'fromNode': canvas_id[s],
            'fromSide': 'right',
            'toNode': canvas_id[t],
            'toSide': 'left',
            'toEnd': 'arrow',
            'label': str(e.get('relation') or ''),
        })

with open(os.path.join(out, f'{note_name(project)}.canvas'), 'w', encoding='utf-8') as fh:
    json.dump({'nodes': canvas_nodes, 'edges': canvas_edges}, fh, indent=2)

# ------------------------------------------------------------ vault settings
conf = os.path.join(out, '.obsidian')
os.makedirs(conf, exist_ok=True)
with open(os.path.join(conf, 'app.json'), 'w', encoding='utf-8') as fh:
    json.dump({'attachmentFolderPath': 'notes', 'newLinkFormat': 'shortest',
               'useMarkdownLinks': False, 'alwaysUpdateLinks': True}, fh, indent=2)
with open(os.path.join(conf, 'appearance.json'), 'w', encoding='utf-8') as fh:
    json.dump({'accentColor': ''}, fh, indent=2)
with open(os.path.join(conf, 'core-plugins.json'), 'w', encoding='utf-8') as fh:
    json.dump(['file-explorer', 'global-search', 'switcher', 'graph', 'backlink',
               'outgoing-link', 'tag-pane', 'page-preview', 'canvas', 'outline'], fh, indent=2)

print(f'  {len(names)} notes, {len(links)} relations, {len(clusters)} clusters')
print(f'  canvas: {len(canvas_nodes)} nodes, {len(canvas_edges)} edges')
if len(names) > len(shown):
    # Never let a cap look like completeness: the notes hold everything, the canvas
    # holds the most connected slice of it.
    print(f'  canvas capped at MAX_CANVAS_NODES={max_canvas}: showing the {len(shown)} '
          f'most connected of {len(names)} entities. Every entity still has a note.')
PYEOF
  then
    echo "";
    echo "Could not build the vault — the graph above was left untouched.";
    rm -rf "${tmp}" ;
    return 1 ;
  fi

  rm -rf "${vault}" ;
  mv "${tmp}" "${vault}" ;

  echo "";
  echo "*---------------------------------------------------------------------*";
  echo "  Vault ready:";
  echo "    ${vault}";
  echo "";
  echo "  Open it:  obsidian://open?path=$(printf '%s' "${vault}" | sed 's|/|%2F|g')";
  echo "  or point Obsidian at the folder above (Open folder as vault).";
  echo "*---------------------------------------------------------------------*";
}

# Throw the vault away. The graph it was made from is left alone.
function obsidian_remove() {
  local ws="${doc_name}" project="${PROJECT_NAME}";
  local vault; vault=$(obsidian_vault_dir "${ws}" "${project}");

  if [ ! -d "${vault}" ] ; then
    echo "No Obsidian vault for ${ws}/${project}." ;
    return 0 ;
  fi
  rm -rf "${vault}" ;
  echo "Removed the Obsidian vault for ${ws}/${project}. The graph is untouched." ;
}

# What is there, without building anything.
function obsidian_status() {
  local ws="${doc_name}" project="${PROJECT_NAME}";
  local vault; vault=$(obsidian_vault_dir "${ws}" "${project}");

  if [ ! -d "${vault}" ] ; then
    echo "${ws}/${project}: no vault yet." ;
    return 0 ;
  fi
  echo "${ws}/${project}: $(find "${vault}/notes" -name '*.md' 2>/dev/null | wc -l) notes at ${vault}" ;
}
