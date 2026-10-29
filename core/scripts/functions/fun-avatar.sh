#!/usr/bin/env bash
# Avatars: talking AI characters as DDEV projects, in the avatars workspace.
#
# An avatar project is the avatar app (avatar.repo in workspace.avatars.settings.yml): a Node app on
# DDEV with no database, a VRM character, Claude Code as its mind, and browser, Piper or ElevenLabs
# voices. These functions build one, add characters to it (characters/<id>.json), give a character its
# own Claude Code agent, and set up voices. Each command wraps one of them:
#
#   cmd-avatar-project.sh            build_avatar
#   cmd-tools-avatar-character.sh    avatar_character
#   cmd-tools-avatar-agent.sh        avatar_agent
#   cmd-tools-avatar-voice.sh        avatar_voice
#   cmd-tools-avatar-catalog.sh      avatar_catalog
#
# DDEV only: the app runs in its web container; nothing here installs Node on the host. Writing JSON
# and reading registries goes through python3, with every value passed in the environment, never
# spliced into code.

# A setting from the avatar: block, one layer of quotes stripped (parse_yaml keeps them) and a
# leading ~ expanded.
function avatar_setting() {
  local value="${!1:-$2}";
  value="${value#\"}"; value="${value%\"}";
  value="${value#\'}"; value="${value%\'}";
  [[ "${value}" == "~"* ]] && value="${HOME}${value:1}";
  echo "${value}";
}

function avatar_dir() {
  echo "${WORKSPACE_ROOT}/avatars/${1}";
}

# The project, or a clear refusal: it must be a folder holding the avatar app.
function avatar_require() {
  local project="$1";
  if [[ -z "${project}" || "${project}" == "_none_" ]]; then
    echo "Name the avatar project, e.g. my-avatar." >&2 ;
    return 1 ;
  fi
  if [[ ! -f "$(avatar_dir "${project}")/avatars.js" ]]; then
    echo "No avatar project at $(avatar_dir "${project}") (no avatars.js there)." >&2 ;
    return 1 ;
  fi
}

# Restart only the app process (a web_extra_daemon), so new characters and agents are read. Quicker
# than ddev restart and leaves the container alone. Does nothing when the project is stopped.
function avatar_restart_app() {
  local dir="$1";
  ( cd "${dir}" && ddev exec supervisorctl restart webextradaemons:avatar >/dev/null 2>&1 ) \
    && echo "Restarted the avatar app." \
    || echo "The project is not running; the change applies on the next ddev start." ;
}

# Build a new avatar project from the avatar app repository.
function build_avatar() {
  local project; project="$( [[ "${PROJECT_NAME}" == "_settings_" ]] && avatar_setting avatar_project my-avatar || echo "${PROJECT_NAME}" )";
  local repo; repo="$( [[ "${REPO}" == "_settings_" ]] && avatar_setting avatar_repo || echo "${REPO}" )";
  if [[ -z "${repo}" || "${repo}" == "CHANGE_ME" ]]; then
    echo "Set avatar.repo in core/config/workspace.avatars.settings.yml to the avatar app repository, or pass --repo <url>." >&2 ;
    return 1 ;
  fi
  local branch; branch="$( [[ "${BRANCH}" == "_settings_" ]] && avatar_setting avatar_branch main || echo "${BRANCH}" )";
  local dir; dir="$(avatar_dir "${project}")";

  if [[ ! "${project}" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]]; then
    echo "The project name becomes a hostname: lowercase letters, digits and hyphens only." >&2 ;
    return 1 ;
  fi
  if [[ -e "${dir}" ]]; then
    echo "${dir} already exists. Pick another name, or remove it first: bash cmd-tools-remove.sh ${project}" >&2 ;
    return 1 ;
  fi
  # Names AND extra hostnames anywhere in the tree: a project's alias is as much a hostname as a name.
  local owner; owner="$(ddev_hostname_owner "${project}")";
  if [[ -n "${owner}" ]] || ddev describe "${project}" >/dev/null 2>&1; then
    echo "${project}.ddev.site is already taken${owner:+ by ${owner}}. Pick another name." >&2 ;
    return 1 ;
  fi

  echo "Cloning ${repo} (${branch}) into ${dir}" ;
  git clone --branch "${branch}" "${repo}" "${dir}" || { echo "Clone failed. The repository is private: check your GitHub access." >&2 ; return 1 ; }

  cd "${dir}" || return 1 ;
  # The name comes from the folder. Any extra hostname the repository declares belongs to its first
  # checkout only: two projects on one hostname is a router conflict where the last to start wins.
  ddev config --project-name="${project}" --additional-hostnames="" >/dev/null || return 1 ;

  ddev start -y || return 1 ;

  if [[ "${LINK_AGENTS}" == "yes" ]]; then
    avatar_link_agents "${dir}" ;
  else
    echo "Agents not linked. Link this project's agents into ~/.claude with: bash cmd-tools-avatar-agent.sh ${project} -a link" ;
  fi

  echo "" ;
  echo "Ready: https://${project}.ddev.site  and  https://${project}.avatars.${hub_domain:-workspace.ddev.site}" ;
  echo "Voices: bash cmd-tools-avatar-voice.sh ${project}    Characters: bash cmd-tools-avatar-character.sh ${project} -a list" ;
  [[ "${LAUNCH}" == "yes" ]] && ddev launch ;
  return 0 ;
}

# --- Characters -------------------------------------------------------------------------------------

# Download a model into public/models/<id>.<ext>. SOURCE is an https URL, or osa:<name or id> from the
# Open Source Avatars registry. Sets AVATAR_FETCHED_MODEL, AVATAR_FETCHED_CREDIT and AVATAR_FETCHED_LICENSE.
function avatar_fetch_model() {
  local dir="$1" id="$2" source="$3" url credit="" license="" registry_id="";
  AVATAR_FETCHED_MODEL=""; AVATAR_FETCHED_CREDIT=""; AVATAR_FETCHED_LICENSE=""; AVATAR_FETCHED_REGISTRY_ID="";

  if [[ "${source}" == osa:* ]]; then
    local found;
    found="$(OSA_URL="$(avatar_setting avatar_osa_index_url)" OSA_WANT="${source#osa:}" python3 - <<'PY'
import json, os, sys, urllib.request
base, want = os.environ['OSA_URL'], os.environ['OSA_WANT'].strip().lower()
get = lambda name: json.load(urllib.request.urlopen(f'{base}/{name}', timeout=30))
# Each collection lists its own avatars (avatar_data_file); its licence is on the collection.
hits = []
for p in get('projects.json'):
    if not p.get('is_public') or not p.get('avatar_data_file'):
        continue
    for a in get(p['avatar_data_file']):
        if a.get('format') == 'VRM' and a.get('is_public') and (a['id'].lower() == want or a['name'].lower() == want):
            hits.append((a, p))
if not hits:
    sys.exit(1)
a, p = hits[0]
print(a['model_file_url'])
print(a['id'])
print(f"{a['name']} from {p.get('name', 'Open Source Avatars')} by {p.get('creator_id', 'unknown')}, via opensourceavatars.com")
print(p.get('license', 'unknown'))
PY
)" || { echo "No public VRM called '${source#osa:}' in the Open Source Avatars registry. List them: bash cmd-tools-avatar-catalog.sh -a avatars" >&2 ; return 1 ; }
    url="$(sed -n 1p <<<"${found}")"; registry_id="$(sed -n 2p <<<"${found}")";
    credit="$(sed -n 3p <<<"${found}")"; license="$(sed -n 4p <<<"${found}")";
  elif [[ "${source}" == https://* ]]; then
    url="${source}";
  else
    echo "A model is an https URL or osa:<name>, or --model-file for a file already in public/models/." >&2 ;
    return 1 ;
  fi

  mkdir -p "${dir}/public/models" ;
  local target="${dir}/public/models/${id}.vrm" tmp;
  tmp="$(mktemp)";
  echo "Downloading the model for ${id}" ;
  if ! curl -fsSL --proto '=https' --max-filesize 104857600 -o "${tmp}" "${url}"; then
    rm -f "${tmp}" ; echo "Download failed: ${url}" >&2 ; return 1 ;
  fi
  # A VRM is a binary glTF: the first four bytes are "glTF". Anything else is not a model.
  if [[ "$(head -c 4 "${tmp}")" != "glTF" ]]; then
    rm -f "${tmp}" ; echo "That file is not a VRM/glTF model (no glTF header)." >&2 ; return 1 ;
  fi
  mv "${tmp}" "${target}" && chmod 644 "${target}" ;
  AVATAR_FETCHED_MODEL="/models/${id}.vrm"; AVATAR_FETCHED_CREDIT="${credit}"; AVATAR_FETCHED_LICENSE="${license}";
  AVATAR_FETCHED_REGISTRY_ID="${registry_id}";
}

function avatar_character() {
  avatar_require "${PROJECT_NAME}" || return 1 ;
  local dir; dir="$(avatar_dir "${PROJECT_NAME}")";
  mkdir -p "${dir}/characters" ;

  case "${ACTION}" in
    list)
      ( cd "${dir}" && DIR="${dir}" python3 - <<'PY'
import json, os, re
d = os.environ['DIR']
src = open(os.path.join(d, 'avatars.js'), encoding='utf8').read()
for m in re.finditer(r"\n    id: '([^']+)',\n    name: '([^']+)'", src):
    print(f"  {m.group(1):<20} {m.group(2):<20} built in (avatars.js)")
for f in sorted(os.listdir(os.path.join(d, 'characters'))):
    if f.endswith('.json'):
        try:
            c = json.load(open(os.path.join(d, 'characters', f), encoding='utf8'))
            v = c.get('voice', {})
            print(f"  {c.get('id', '?'):<20} {c.get('name', '?'):<20} characters/{f}  voice: {v.get('engine')}/{v.get('voice')}  agent: {c.get('agent', '-')}")
        except Exception as e:
            print(f"  {f}: unreadable ({e})")
PY
      ) ;;
    add)
      if [[ "${ID}" == "_none_" || ! "${ID}" =~ ^[a-z0-9][a-z0-9-]{0,39}$ ]]; then
        echo "--id is required: lowercase letters, digits and hyphens, e.g. ada." >&2 ; return 1 ;
      fi
      [[ "${NAME}" == "_none_" ]] && { echo "--name is required." >&2 ; return 1 ; }
      if [[ -e "${dir}/characters/${ID}.json" && "${REPLACE}" != "yes" ]]; then
        echo "characters/${ID}.json exists. Pass --replace to overwrite it." >&2 ; return 1 ;
      fi

      local model="" credit="${CREDIT}" license="" registry_id="";
      if [[ "${MODEL_FILE}" != "_none_" ]]; then
        [[ -f "${dir}/public/models/${MODEL_FILE}" ]] || { echo "No public/models/${MODEL_FILE} in the project." >&2 ; return 1 ; }
        model="/models/${MODEL_FILE}";
      elif [[ "${MODEL}" != "_none_" ]]; then
        avatar_fetch_model "${dir}" "${ID}" "${MODEL}" || return 1 ;
        model="${AVATAR_FETCHED_MODEL}"; license="${AVATAR_FETCHED_LICENSE}"; registry_id="${AVATAR_FETCHED_REGISTRY_ID}";
        [[ "${credit}" == "_none_" ]] && credit="${AVATAR_FETCHED_CREDIT}";
      else
        echo "Give the character a model: --model <https URL | osa:<name>> or --model-file <file in public/models/>." >&2 ;
        return 1 ;
      fi

      # Free voices by default: the settings' engine and voice, unless the command names others.
      local engine="${VOICE_ENGINE}" voice="${VOICE}";
      [[ "${engine}" == "_settings_" ]] && engine="$(avatar_setting avatar_voice_engine piper)";
      if [[ "${voice}" == "_settings_" ]]; then
        if [[ "${engine}" == "piper" ]]; then voice="$(avatar_setting avatar_voice en_US-lessac-medium)"; else voice=""; fi
      fi
      if [[ "${engine}" == "elevenlabs" && -z "${voice}" ]]; then
        echo "An ElevenLabs voice needs --voice <voice id>; ElevenLabs spends credits for every sentence." >&2 ; return 1 ;
      fi

      local persona="";
      if [[ "${PERSONA_FILE}" != "_none_" ]]; then
        [[ -f "${PERSONA_FILE}" ]] || { echo "No persona file at ${PERSONA_FILE}." >&2 ; return 1 ; }
        persona="$(cat "${PERSONA_FILE}")";
      fi

      C_DIR="${dir}" C_ID="${ID}" C_NAME="${NAME}" C_MODEL="${model}" C_CREDIT="$([[ "${credit}" == "_none_" ]] || echo "${credit}")" \
      C_LICENSE="${license}" C_REGISTRY="${registry_id}" C_LANG="${LANGUAGE}" C_GENDER="$([[ "${GENDER}" == "_none_" ]] || echo "${GENDER}")" \
      C_ENGINE="${engine}" C_VOICE="${voice}" C_PERSONA="${persona}" \
      C_AGENT="$([[ "${AGENT}" == "_none_" ]] || echo "${AGENT}")" python3 - <<'PY' || return 1
import json, os
e = os.environ
c = {'id': e['C_ID'], 'name': e['C_NAME'], 'title': e['C_NAME'], 'model': e['C_MODEL'], 'language': e['C_LANG'],
     'voice': {'engine': e['C_ENGINE'], 'voice': e['C_VOICE'], 'rate': 1, 'pitch': 1},
     'fallback': {'engine': 'browser', 'voice': '', 'rate': 1, 'pitch': 1}}
for key, env in (('gender', 'C_GENDER'), ('agent', 'C_AGENT'), ('persona', 'C_PERSONA'), ('registryId', 'C_REGISTRY')):
    if e.get(env):
        c[key] = e[env]
credit = e.get('C_CREDIT', '')
if e.get('C_LICENSE'):
    credit = f"{credit}. Licence: {e['C_LICENSE']} (as the registry lists it; confirm on the avatar's page)".lstrip('. ')
if credit:
    c['credit'] = credit
path = os.path.join(e['C_DIR'], 'characters', f"{c['id']}.json")
with open(path, 'w', encoding='utf8') as f:
    json.dump(c, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f"Wrote characters/{c['id']}.json")
PY
      [[ -n "${license}" ]] && echo "Licence from the registry: ${license}. Confirm it on the avatar's own page before you share it." ;
      avatar_restart_app "${dir}" ;
      echo "Give ${NAME} a mind of its own: bash cmd-tools-avatar-agent.sh ${PROJECT_NAME} -a create --id ${ID}" ;
      ;;
    remove)
      [[ -f "${dir}/characters/${ID}.json" ]] || { echo "No characters/${ID}.json in ${PROJECT_NAME}." >&2 ; return 1 ; }
      # The JSON is moved aside, not deleted, and the model file is left where it is.
      mv "${dir}/characters/${ID}.json" "${dir}/characters/${ID}.json.removed" ;
      echo "Moved characters/${ID}.json to characters/${ID}.json.removed (its model in public/models/ is kept)." ;
      avatar_restart_app "${dir}" ;
      ;;
  esac
}

# --- Agents -----------------------------------------------------------------------------------------

# Link the agents a project keeps in claude/agents/ (and its knowledge files in claude/) into ~/.claude,
# where Claude Code reads them; or only the files given after the project folder. A real file already
# there is kept aside as .bak. A link that points at ANOTHER project's copy is left alone unless
# REPLACE=yes: every avatar project is a clone of the same app, so each one carries the app's own
# agents, and linking them all would silently move those agents to whichever copy was linked last.
function avatar_link_agents() {
  local dir="$1"; shift;
  local files=("$@") f dest current;
  [[ ${#files[@]} -eq 0 ]] && files=("${dir}"/claude/agents/*.md "${dir}"/claude/*.md);
  mkdir -p "${HOME}/.claude/agents" ;
  for f in "${files[@]}"; do
    [[ -f "${f}" ]] || continue ;
    dest="${HOME}/.claude/${f#"${dir}/claude/"}";
    current="$(readlink "${dest}" 2>/dev/null)";
    if [[ -n "${current}" && "${current}" != "${f}" && -e "${current}" && "${REPLACE}" != "yes" ]]; then
      echo "left ${dest}: it links to ${current} (pass --replace to point it here)" ;
      continue ;
    fi
    if [[ -e "${dest}" && ! -L "${dest}" ]]; then mv "${dest}" "${dest}.bak"; echo "kept the old ${dest} as ${dest}.bak"; fi
    ln -sfn "${f}" "${dest}" && echo "linked ${dest}" ;
  done
}

function avatar_agent() {
  avatar_require "${PROJECT_NAME}" || return 1 ;
  local dir; dir="$(avatar_dir "${PROJECT_NAME}")";
  local prefix; prefix="$(avatar_setting avatar_agent_prefix avatar-)";

  case "${ACTION}" in
    list)
      local f name target;
      for f in "${dir}"/claude/agents/*.md; do
        [[ -f "${f}" ]] || continue ;
        name="$(basename "${f}" .md)";
        target="$(readlink "${HOME}/.claude/agents/${name}.md" 2>/dev/null)";
        if [[ "${target}" == "${f}" ]]; then echo "  ${name}  linked"; elif [[ -n "${target}" ]]; then echo "  ${name}  linked to ANOTHER copy: ${target}"; else echo "  ${name}  not linked"; fi
      done ;;
    link)
      avatar_link_agents "${dir}" ;
      avatar_restart_app "${dir}" ;;
    create)
      [[ "${ID}" == "_none_" ]] && { echo "--id is required: the character the agent is the mind of." >&2 ; return 1 ; }
      local character="${dir}/characters/${ID}.json" agent="${prefix}${ID}";
      [[ -f "${character}" ]] || { echo "No characters/${ID}.json. Add the character first: bash cmd-tools-avatar-character.sh ${PROJECT_NAME} -a add --id ${ID} ..." >&2 ; return 1 ; }
      local file="${dir}/claude/agents/${agent}.md";
      if [[ -e "${file}" && "${REPLACE}" != "yes" ]]; then
        echo "claude/agents/${agent}.md exists. Pass --replace to write it again." >&2 ; return 1 ;
      fi
      mkdir -p "${dir}/claude/agents" ;
      A_CHAR="${character}" A_FILE="${file}" A_NAME="${agent}" A_HOST="${PROJECT_NAME}.ddev.site" python3 - <<'PY' || return 1
import json, os
e = os.environ
c = json.load(open(e['A_CHAR'], encoding='utf8'))
name, who = e['A_NAME'], c['name']
persona = c.get('persona') or f"You are {who}, a friendly guide who answers questions clearly and kindly."
body = f"""---
name: {name}
description: Use this agent to be {who}, the talking character of the avatar at https://{e['A_HOST']} (speaking, moving, lip-synced), and in a terminal. Invoke for "talk to {who}" or "{who}, ...".
tools: Read, Glob, Grep, Skill
---

{persona}

## How you speak

- You are heard, not read: short sentences, one idea each, no lists or headings, no Markdown.
- Answer in the language the user writes in.
- Keep gesture tags such as [wave], [think] or [cheer] for the start of a sentence; the avatar plays them.
- You can read files in the workspace to answer, but you never change anything.
"""
open(e['A_FILE'], 'w', encoding='utf8').write(body)
c['agent'] = name
json.dump(c, open(e['A_CHAR'], 'w', encoding='utf8'), ensure_ascii=False, indent=2)
print(f"Wrote claude/agents/{name}.md and set \"agent\": \"{name}\" in characters/{c['id']}.json")
PY
      avatar_link_agents "${dir}" "${file}" ;
      avatar_restart_app "${dir}" ;
      echo "Edit the agent to give ${ID} its voice and knowledge: ${file}" ;;
    check)
      echo "Claude Code in the container:" ;
      ( cd "${dir}" && ddev exec claude --version 2>/dev/null ) || echo "  not available: is the project running? (ddev start)" ;
      ( cd "${dir}" && ddev exec test -s "${HOME}/.claude/.credentials.json" 2>/dev/null ) \
        && echo "  logged in (your ~/.claude is mounted)" \
        || echo "  no login found in the container: run claude once on this machine and log in, then ddev restart" ;
      ACTION=list avatar_agent ;;
  esac
}

# --- Voices -----------------------------------------------------------------------------------------

function avatar_voice() {
  local piper_dir; piper_dir="$(avatar_setting avatar_piper_voices_dir "${HOME}/.local/share/piper-voices")";
  local dir="";
  if [[ "${ACTION}" != "piper-list" && "${ACTION}" != "piper-install" ]]; then
    avatar_require "${PROJECT_NAME}" || return 1 ;
    dir="$(avatar_dir "${PROJECT_NAME}")";
  fi

  case "${ACTION}" in
    status)
      echo "Voices for ${PROJECT_NAME}:" ;
      echo "  browser     free, always available (the browser's own voices)" ;
      local count; count="$(find "${piper_dir}" -name '*.onnx' 2>/dev/null | wc -l)";
      echo "  piper       free, offline: ${count} voice(s) in ${piper_dir}" ;
      if grep -q '^ELEVENLABS_API_KEY=.' "${dir}/.ddev/.env.web" 2>/dev/null; then
        echo "  elevenlabs  key linked (spends credits per sentence)" ;
      else
        echo "  elevenlabs  no key linked: bash cmd-tools-avatar-voice.sh ${PROJECT_NAME} -a elevenlabs-link" ;
      fi ;;
    piper-list)
      find "${piper_dir}" -name '*.onnx' 2>/dev/null | sed "s#${piper_dir}/##; s#\.onnx\$##" | sort | sed 's/^/  /' ;
      [[ -d "${piper_dir}" ]] || echo "  none yet: bash cmd-tools-avatar-voice.sh -a piper-install --voice en_GB-alba-medium" ;;
    piper-install)
      # en_GB-alba-medium lives at en/en_GB/alba/medium/en_GB-alba-medium.onnx (+ .onnx.json).
      if [[ ! "${VOICE}" =~ ^([a-z]{2,3})_([A-Z]{2})-([a-z0-9_]+)-(x_low|low|medium|high)$ ]]; then
        echo "--voice is a Piper voice name such as en_GB-alba-medium or ar_JO-kareem-medium." >&2 ; return 1 ;
      fi
      local lang="${BASH_REMATCH[1]}" region="${BASH_REMATCH[1]}_${BASH_REMATCH[2]}" speaker="${BASH_REMATCH[3]}" quality="${BASH_REMATCH[4]}";
      local base; base="$(avatar_setting avatar_piper_voices_url)/${lang}/${region}/${speaker}/${quality}/${VOICE}";
      mkdir -p "${piper_dir}" ;
      local f;
      for f in onnx onnx.json; do
        curl -fsSL --proto '=https' -o "${piper_dir}/${VOICE}.${f}.part" "${base}.${f}" \
          && mv "${piper_dir}/${VOICE}.${f}.part" "${piper_dir}/${VOICE}.${f}" \
          || { rm -f "${piper_dir}/${VOICE}.${f}.part" ; echo "Could not download ${VOICE}.${f}: check the name at https://huggingface.co/rhasspy/piper-voices" >&2 ; return 1 ; }
      done
      echo "Installed ${VOICE} into ${piper_dir}. Check its MODEL_CARD on the model page for its licence." ;
      echo "Avatar projects see it after a restart (the folder is mounted read-only)." ;;
    elevenlabs-link)
      ( cd "${dir}" && ./link-elevenlabs.sh ) || return 1 ;
      avatar_restart_app "${dir}" ;;
    elevenlabs-unlink)
      ( cd "${dir}" && ./link-elevenlabs.sh --remove ) || return 1 ;
      avatar_restart_app "${dir}" ;;
  esac
}

# --- Catalog ----------------------------------------------------------------------------------------

# What can give an avatar a body or a voice, with the licence and whether the avatar app speaks it
# today. Licences are as their own projects state them (checked October 2026); a model or voice
# inside a collection can carry its own terms.
function avatar_catalog() {
  case "${ACTION}" in
    voices)
      cat <<'TXT'
Voices                     Licence                        In the avatar app
  Browser (Web Speech)     the browser's                  yes: engine "browser", free
  Piper voices             MIT model card; per voice      yes: engine "piper", free, offline   (-a piper-install)
                           (code: rhasspy/piper MIT, archived; OHF-Voice/piper1-gpl GPL-3.0)
  ElevenLabs               paid service, per credits      yes: engine "elevenlabs"             (-a elevenlabs-link)
  Kokoro-82M               Apache-2.0                     not yet: free, runs locally (kokoro-js); no Arabic
  Chatterbox (Resemble)    MIT                            not yet: free, local, needs a GPU to be quick
  MeloTTS (MyShell)        MIT                            not yet: free, local, CPU-friendly
  Coqui XTTS-v2            CPML, non-commercial only      avoid for anything shared or commercial
TXT
      ;;
    avatars)
      cat <<'TXT'
Avatar libraries           Licence                        How to use one
  Open Source Avatars      per collection: mostly CC0,    --model osa:<name>   (licence and credit saved with it)
  (opensourceavatars.com)  VIPE Heroes CC-BY
  VRoid Hub                set by each creator            download what the creator allows, then --model-file
  VRoid Studio             your own model                 make one, export VRM, then --model-file
  Ready Player Me          service ended 31 January 2026  existing GLB exports still load; no new ones
TXT
      if [[ "${LIST}" == "yes" ]]; then
        echo "" ; echo "Open Source Avatars registry (public VRMs):" ;
        OSA_URL="$(avatar_setting avatar_osa_index_url)" python3 - <<'PY'
import json, os, urllib.request
base = os.environ['OSA_URL']
get = lambda name: json.load(urllib.request.urlopen(f'{base}/{name}', timeout=30))
for p in get('projects.json'):
    if not p.get('is_public') or not p.get('avatar_data_file'):
        continue
    for a in get(p['avatar_data_file']):
        if a.get('format') == 'VRM' and a.get('is_public'):
            print(f"  osa:{a['name']:<28} {p.get('license', '?'):<6} {p.get('name', '')}")
PY
      fi ;;
  esac
}
