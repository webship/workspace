#!/usr/bin/env python3
"""ElevenLabs for the final voiceover of a narrated video. Standard library only.

Run through videos/cmd-tools-elevenlabs.sh, which reads the key from settings.yml and hands it over in
ELEVENLABS_API_KEY. Anything that spends credits prints a plan and stops unless --confirm is given.
Exit codes: 0 ok, 1 error, 2 usage, 3 no key, 4 plan only, 5 sections do not fit their windows.
"""

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

OK, ERROR, USAGE, NO_KEY, PLAN_ONLY, NO_FIT = 0, 1, 2, 3, 4, 5
DEFAULT_BASE = 'https://api.elevenlabs.io'
DEFAULT_MODEL = 'eleven_v4'
DEFAULT_FORMAT = 'mp3_44100_128'
SPEECH_CHARS_PER_SECOND = 15.0
SLACK = 0.05

HEADING = re.compile(
    r'^##\s+(\S+)\s+(.+?)\s+\(((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)\s+to\s+((?:\d+:)?\d{1,2}:\d{2}(?:\.\d+)?)\)\s*$')
HINTS = {
    401: 'ElevenLabs rejected the key.',
    403: 'The key is not allowed to do that.',
    404: 'Not found (check the voice id).',
    429: 'ElevenLabs is rate limiting this key. Wait, then run it again; finished sections are kept.',
}


class Stop(Exception):
    def __init__(self, message, code=ERROR):
        super().__init__(message)
        self.code = code


def emit(args, data, lines):
    print(json.dumps(data, indent=2) if args.json else '\n'.join(lines))


def mmss(seconds):
    return '%02d:%04.1f' % (int(seconds // 60), seconds % 60)


def seconds_of(stamp):
    total = 0.0
    for part in stamp.split(':'):
        total = total * 60 + float(part)
    return total


def sha(*parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()


def stem_of(path):
    return os.path.splitext(os.path.basename(path))[0]


def safe_id(text):
    return re.sub(r'[^A-Za-z0-9_-]', '_', text)


def read_bytes(path):
    with open(path, 'rb') as handle:
        return handle.read()


def read_json(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def ensure_free(paths, force):
    for path in paths:
        if os.path.exists(path) and not force:
            raise Stop('%s already exists. Pass --force to replace it. Nothing was sent.' % path)


def track_of(out):
    return os.path.splitext(out)[0] + '-voiceover.mp3'


def write_atomic(path, data, force):
    if os.path.exists(path) and not force:
        raise Stop('%s already exists. Pass --force to replace it.' % path)
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    part = os.path.join(folder, '.%s.%s.part' % (os.path.basename(path), uuid.uuid4().hex[:8]))
    with open(part, 'wb') as handle:
        handle.write(data)
    os.replace(part, path)


# ---- the API

def key():
    value = os.environ.get('ELEVENLABS_API_KEY', '').strip()
    if not value:
        raise Stop('No ElevenLabs key is set. Add it at /settings (ElevenLabs), or run: bash cmd-tools-elevenlabs.sh -a init', NO_KEY)
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', value):
        raise Stop('The ElevenLabs key has characters a key never has. Check the value in settings.yml.', NO_KEY)
    return value


def call(method, path, body=None, content_type=None, query=None):
    url = os.environ.get('ELEVENLABS_API_BASE', DEFAULT_BASE).rstrip('/') + path
    if query:
        url += '?' + urllib.parse.urlencode(query)
    headers = {'xi-api-key': key()}
    if content_type:
        headers['Content-Type'] = content_type
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=int(os.environ.get('ELEVENLABS_TIMEOUT', '300'))) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.headers, error.read()
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise Stop('Could not reach ElevenLabs (%s).' % getattr(error, 'reason', error))


ID_LIKE = re.compile(r'[A-Za-z0-9]{16,32}')


def resolve_voice(value):
    """A voice given by name (Brian) becomes its id on this account; an id is left alone."""
    if ID_LIKE.fullmatch(value):
        return value
    status, _, body = call('GET', '/v2/voices', query={'search': value, 'page_size': '30'})
    if status != 200:
        raise Stop('Could not look up the voice "%s". %s' % (value, explain(status, body)))
    voices = json.loads(body).get('voices', [])
    want = value.strip().lower()
    hit = (next((v for v in voices if (v.get('name') or '').lower() == want), None)
           or next((v for v in voices if (v.get('name') or '').lower().startswith(want)), None))
    if not hit:
        raise Stop('No voice named "%s" on this account. List them with -a voices.' % value, USAGE)
    return hit['voice_id']


def explain(status, body):
    detail = ''
    try:
        found = json.loads(body.decode('utf-8', 'replace')).get('detail')
        if isinstance(found, dict):
            detail = found.get('message') or found.get('status') or ''
        elif isinstance(found, list):
            detail = '; '.join(str(item.get('msg', item)) if isinstance(item, dict) else str(item) for item in found[:3])
        elif found:
            detail = str(found)
    except Exception:
        detail = body.decode('utf-8', 'replace')[:160].replace('\n', ' ')
    hint = HINTS.get(status) or ('ElevenLabs had a server error; run it again later.' if status >= 500 else '')
    return ' '.join(part for part in ('HTTP %d.' % status, hint, detail) if part)


def multipart(fields, files):
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n' % (boundary, name, value)).encode())
    for name, filename, data in files:
        parts.append(('--%s\r\nContent-Disposition: form-data; name="%s"; filename="%s"\r\n'
                      'Content-Type: application/octet-stream\r\n\r\n' % (boundary, name, filename)).encode() + data + b'\r\n')
    parts.append(('--%s--\r\n' % boundary).encode())
    return b''.join(parts), 'multipart/form-data; boundary=%s' % boundary


def account():
    status, _, body = call('GET', '/v1/user/subscription')
    if status != 200:
        return None, explain(status, body)
    found = json.loads(body)
    used, limit = found.get('character_count'), found.get('character_limit')
    return {
        'tier': found.get('tier'), 'status': found.get('status'), 'used': used, 'limit': limit,
        'remaining': limit - used if isinstance(used, int) and isinstance(limit, int) else None,
        'resets': found.get('next_character_count_reset_unix'),
    }, ''


def remaining_characters():
    try:
        found, _ = account()
    except Stop:
        return None
    return found['remaining'] if found else None


# Brand names the voices misread: a client heard "Var-dough" for Vardot in a final video. The respelling is
# applied ONLY to the text sent to the voice. Scripts, captions, transcripts, character counts and the
# saved section text keep the real spelling. ELEVENLABS_PRONUNCIATION ("Word=Respelling; Word=Respelling",
# from elevenlabs.pronunciation in settings.yml) adds to or overrides these.
PRONUNCIATIONS = {'Vardot': 'Var-dot', 'Varbase': 'Var-base'}


def pronunciations():
    table = dict(PRONUNCIATIONS)
    for pair in os.environ.get('ELEVENLABS_PRONUNCIATION', '').split(';'):
        word, _, said = pair.partition('=')
        if word.strip() and said.strip():
            table[word.strip()] = said.strip()
    return table


def respell(text):
    for word, said in pronunciations().items():
        text = re.sub(r'(?<![\w-])%s(?![\w-])' % re.escape(word), said, text)
    return text


def synthesize(text, voice, model, fmt):
    body = json.dumps({'text': respell(text), 'model_id': model}).encode()
    status, headers, data = call('POST', '/v1/text-to-speech/' + urllib.parse.quote(voice, safe=''), body=body,
                                 content_type='application/json', query={'output_format': fmt})
    if status != 200 or not data or 'json' in (headers.get('content-type') or ''):
        raise Stop('Speech failed. ' + explain(status, data))
    return data, {'request_id': headers.get('request-id'), 'characters': headers.get('x-character-count')}


# ---- media

def need_tools():
    for tool in ('ffmpeg', 'ffprobe'):
        if not shutil.which(tool):
            raise Stop('%s is needed and was not found on PATH.' % tool)


def run(command):
    done = subprocess.run(command, capture_output=True, text=True)
    if done.returncode != 0:
        raise Stop('%s failed: %s' % (command[0], (done.stderr or '').strip().splitlines()[-1:] or 'no output'))


def duration(path):
    try:
        done = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
                              capture_output=True, text=True, timeout=60)
        return float(done.stdout.strip())
    except Exception:
        return None


def mux(video, mix_wav, out, length, force):
    ensure_free([out, track_of(out)], force)
    part = os.path.join(os.path.dirname(os.path.abspath(out)), '.%s.part' % os.path.basename(out))
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', video, '-i', mix_wav, '-map', '0:v:0', '-map', '1:a:0',
         '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-t', '%.3f' % length, '-f', 'mp4', part])
    os.replace(part, out)
    track = track_of(out)
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mix_wav, '-c:a', 'libmp3lame', '-b:a', '192k', track])
    poster = os.path.splitext(video)[0] + '-poster.jpg'
    new_poster = os.path.splitext(out)[0] + '-poster.jpg'
    if os.path.exists(poster) and (force or not os.path.exists(new_poster)):
        shutil.copyfile(poster, new_poster)
    os.remove(mix_wav)
    return track, new_poster if os.path.exists(new_poster) else None


# ---- the script

def clean(line):
    text = re.sub(r'\*\(optional\)\*', '', line)
    text = re.sub(r'\[([^\]]+)\]\([^)]*\)', r'\1', text)
    return ' '.join(re.sub(r'[*`]', '', text).split())


def load_sections(path, drop_optional=False):
    try:
        with open(path, encoding='utf-8') as handle:
            lines = handle.read().splitlines()
    except OSError as error:
        raise Stop('Cannot read the script: %s' % error)
    sections, current = [], None
    for line in lines:
        found = HEADING.match(line)
        if found:
            current = {'id': found.group(1), 'title': found.group(2), 'start': seconds_of(found.group(3)),
                       'end': seconds_of(found.group(4)), 'spoken': [], 'optional': []}
            sections.append(current)
        elif line.startswith('## '):
            current = None
        elif current is not None and line.startswith('>'):
            spoken = clean(line.lstrip('>'))
            if spoken:
                (current['optional'] if '*(optional)*' in line else current['spoken']).append((len(current['spoken']) + len(current['optional']), spoken))
    if not sections:
        raise Stop('No timed sections found. Each section needs a heading like "## D01 Opening (00:00.0 to 00:21.4)" and its '
                   'spoken lines as "> " quotes. See the vardot-elevenlabs-voiceover skill.')
    result, previous_end = [], 0.0
    for section in sections:
        if section['end'] <= section['start']:
            raise Stop('Section %s ends before it starts.' % section['id'])
        if section['start'] < previous_end - SLACK:
            raise Stop('Section %s starts before the previous section ends.' % section['id'])
        previous_end = section['end']
        kept = sorted(section['spoken'] + ([] if drop_optional else section['optional']))
        text = ' '.join(item[1] for item in kept)
        if not text:
            continue
        result.append({
            'id': section['id'], 'title': section['title'], 'start': section['start'], 'end': section['end'],
            'window': round(section['end'] - section['start'], 3), 'text': text, 'chars': len(text),
            'optional_chars': sum(len(item[1]) for item in section['optional']),
        })
    if not result:
        raise Stop('The script has sections but no spoken lines ("> " quotes).')
    return result


def check_inputs(args):
    for attribute in ('script', 'video', 'audio'):
        value = getattr(args, attribute, None)
        if value and not os.path.isfile(value):
            raise Stop('%s not found: %s' % (attribute.capitalize(), value), USAGE)


def work_dir(args):
    return args.work or os.path.join(os.path.dirname(os.path.abspath(args.out)), stem_of(args.out) + '-voiceover-sections')


def audio_ext(fmt):
    if not re.fullmatch(r'(mp3|wav)_\d+(_\d+)?', fmt):
        raise Stop('The format must be an mp3_* or wav_* one, for example %s.' % DEFAULT_FORMAT, USAGE)
    return fmt.split('_')[0]


# ---- commands

def cmd_sections(args):
    check_inputs(args)
    sections = load_sections(args.script, args.drop_optional)
    lines = ['%-5s %-34s %-18s %7s %6s %9s' % ('id', 'section', 'window', 'seconds', 'chars', 'optional')]
    for s in sections:
        lines.append('%-5s %-34s %-18s %7.1f %6d %9d' % (s['id'], s['title'][:34], '%s to %s' % (mmss(s['start']), mmss(s['end'])),
                                                          s['window'], s['chars'], s['optional_chars']))
    lines.append('%d sections, %d characters.' % (len(sections), sum(s['chars'] for s in sections)))
    emit(args, {'sections': sections, 'characters': sum(s['chars'] for s in sections)}, lines)
    return OK


def cmd_voices(args):
    query = {'page_size': str(args.limit)}
    if args.search:
        query['search'] = args.search
    status, _, body = call('GET', '/v2/voices', query=query)
    if status != 200:
        raise Stop('Could not list voices. ' + explain(status, body))
    voices = json.loads(body).get('voices', [])
    rows = [{'id': v.get('voice_id'), 'name': v.get('name'), 'category': v.get('category'), 'labels': v.get('labels') or {}} for v in voices]
    lines = ['%-24s %-22s %-10s %s' % ('id', 'name', 'category', 'labels')]
    for r in rows:
        lines.append('%-24s %-22s %-10s %s' % (r['id'], (r['name'] or '')[:22], r['category'] or '', ', '.join('%s=%s' % kv for kv in r['labels'].items())))
    emit(args, {'voices': rows}, lines)
    return OK


def cmd_account(args):
    found, why = account()
    if not found:
        raise Stop('The key works for requests but the account cannot be read. %s Grant the key "User: read" to see credits.' % why)
    resets = datetime.datetime.fromtimestamp(found['resets'], datetime.timezone.utc).strftime('%Y-%m-%d') if found['resets'] else 'unknown'
    emit(args, found, ['Plan: %s (%s)' % (found['tier'], found['status']), 'Characters used: %s of %s' % (found['used'], found['limit']),
                       'Remaining: %s' % found['remaining'], 'Resets: %s' % resets])
    return OK


def cmd_speak(args):
    try:
        with open(args.text_file, encoding='utf-8') as handle:
            text = handle.read().strip()
    except OSError:
        text = ''
    if not text:
        raise Stop('The text file is missing or empty: %s' % args.text_file, USAGE)
    key()
    remaining = remaining_characters()
    plan = {'voice': args.voice, 'model': args.model, 'format': args.format, 'characters': len(text), 'remaining': remaining, 'out': args.out}
    if not args.confirm:
        emit(args, dict(plan, confirmed=False), ['Plan only, nothing was sent.', 'Voice %s, model %s, %d characters.' % (args.voice, args.model, len(text)),
                                                  'Credits left: %s.' % ('unknown' if remaining is None else remaining), 'Run again with --confirm to create %s.' % args.out])
        return PLAN_ONLY
    ensure_free([args.out], args.force)
    data, meta = synthesize(text, args.voice, args.model, args.format)
    write_atomic(args.out, data, args.force)
    emit(args, dict(plan, confirmed=True, bytes=len(data), seconds=duration(args.out), **meta), ['Wrote %s (%d bytes).' % (args.out, len(data))])
    return OK


def cmd_isolate(args):
    check_inputs(args)
    key()
    seconds = duration(args.audio)
    plan = {'audio': args.audio, 'seconds': seconds, 'out': args.out}
    if not args.confirm:
        emit(args, dict(plan, confirmed=False), ['Plan only, nothing was sent.', 'Would clean %s (%s seconds) and write %s.' % (args.audio, seconds, args.out),
                                                  'Run again with --confirm.'])
        return PLAN_ONLY
    ensure_free([args.out], args.force)
    body, content_type = multipart({}, [('audio', os.path.basename(args.audio), read_bytes(args.audio))])
    status, _, data = call('POST', '/v1/audio-isolation', body=body, content_type=content_type)
    if status != 200 or not data:
        raise Stop('Isolation failed. ' + explain(status, data))
    write_atomic(args.out, data, args.force)
    emit(args, dict(plan, confirmed=True, bytes=len(data)), ['Wrote %s (%d bytes).' % (args.out, len(data))])
    return OK


def cmd_voiceover(args):
    check_inputs(args)
    need_tools()
    key()
    ext = audio_ext(args.format)
    sections = load_sections(args.script, args.drop_optional)
    length = duration(args.video)
    if not length:
        raise Stop('Cannot read the video duration: %s' % args.video)
    if sections[-1]['end'] > length + 1.0:
        raise Stop('The script runs to %s but the video is only %s long. Is this the right draft?' % (mmss(sections[-1]['end']), mmss(length)))
    work = work_dir(args)
    for s in sections:
        s['fingerprint'] = sha(s['text'], args.voice, args.model, args.format, pronunciations())
        s['file'] = os.path.join(work, '%s.%s' % (safe_id(s['id']), ext))
        meta_path = os.path.join(work, '%s.json' % safe_id(s['id']))
        try:
            s['cached'] = os.path.isfile(s['file']) and not args.redo and read_json(meta_path)['fingerprint'] == s['fingerprint']
        except (OSError, ValueError, KeyError):
            s['cached'] = False
    todo = [s for s in sections if not s['cached']]
    to_send = sum(s['chars'] for s in todo)
    remaining = remaining_characters()
    rows = [dict(id=s['id'], title=s['title'], window=s['window'], chars=s['chars'], rough_seconds=round(s['chars'] / SPEECH_CHARS_PER_SECOND, 1),
                 may_be_long=s['chars'] / SPEECH_CHARS_PER_SECOND > s['window'] * 1.05, cached=s['cached'], has_optional=s['optional_chars'] > 0)
            for s in sections]
    plan = {'script': args.script, 'video': args.video, 'out': args.out, 'voice': args.voice, 'model': args.model, 'sections': rows,
            'characters_to_send': to_send, 'remaining': remaining, 'enough': None if remaining is None else remaining >= to_send, 'work': work}
    if not args.confirm:
        lines = ['Plan only, nothing was sent.', 'Voice %s, model %s. Video %s long.' % (args.voice, args.model, mmss(length)),
                 '%-5s %-30s %7s %6s %9s  %s' % ('id', 'section', 'window', 'chars', '~seconds', 'note')]
        for r in rows:
            note = 'already made, no cost' if r['cached'] else ('may run long' + (' (has an optional sentence)' if r['has_optional'] else '') if r['may_be_long'] else '')
            lines.append('%-5s %-30s %6.1fs %6d %9.1f  %s' % (r['id'], r['title'][:30], r['window'], r['chars'], r['rough_seconds'], note))
        lines += ['%d characters would be sent; credits left: %s.' % (to_send, 'unknown' if remaining is None else remaining),
                  '"~seconds" is a rough estimate from the character count. Run again with --confirm to create the voiceover.']
        emit(args, dict(plan, confirmed=False), lines)
        return PLAN_ONLY
    if remaining is not None and remaining < to_send:
        raise Stop('Not enough credits: %d characters to send, %d left. Nothing was sent.' % (to_send, remaining))
    ensure_free([args.out, track_of(args.out)], args.force)
    os.makedirs(work, exist_ok=True)
    for s in todo:
        data, meta = synthesize(s['text'], args.voice, args.model, args.format)
        write_atomic(s['file'], data, True)
        with open(os.path.join(work, '%s.json' % safe_id(s['id'])), 'w') as handle:
            json.dump(dict(meta, fingerprint=s['fingerprint'], id=s['id']), handle)
    report = []
    for s in sections:
        seconds = duration(s['file'])
        row = {'id': s['id'], 'title': s['title'], 'window': s['window'], 'audio_seconds': seconds, 'fit': 'ok', 'speedup': 1.0, 'audio': s['file']}
        if seconds is None:
            raise Stop('Cannot read the audio for section %s.' % s['id'])
        if seconds > s['window'] + SLACK:
            ratio = seconds / s['window']
            if ratio <= args.max_speedup:
                fitted = os.path.join(work, '%s-fit.wav' % safe_id(s['id']))
                run(['ffmpeg', '-y', '-loglevel', 'error', '-i', s['file'], '-filter:a', 'atempo=%.5f' % ratio, '-ar', '44100', '-ac', '1', fitted])
                row.update(fit='sped_up', speedup=round(ratio, 4), audio=fitted, audio_seconds=duration(fitted))
            else:
                row.update(fit='too_long', speedup=round(ratio, 4), over_by=round(seconds - s['window'], 2), has_optional=s['optional_chars'] > 0)
        report.append(row)
    too_long = [r for r in report if r['fit'] == 'too_long']
    if too_long:
        lines = ['Created %d new section(s), but %d %s not fit its window, so no video was made. Finished sections are kept.' % (len(todo), len(too_long), 'does' if len(too_long) == 1 else 'do')]
        lines += ['  %s %s: %.1fs of speech in a %.1fs window (%.1fs over)%s' % (r['id'], r['title'], r['audio_seconds'], r['window'], r['over_by'],
                                                                              ', has an optional sentence to drop' if r['has_optional'] else '') for r in too_long]
        lines.append('Shorten the text in the script (or use --drop-optional), then run again: only the changed sections are sent.')
        emit(args, {'confirmed': True, 'fit': False, 'sections': report}, lines)
        return NO_FIT
    mix = os.path.join(work, '_mix.wav')
    chains = ['[%d:a]aformat=sample_rates=44100:channel_layouts=mono,adelay=%d:all=1[a%d]' % (i + 1, round(s['start'] * 1000), i) for i, s in enumerate(sections)]
    chains.append('%samix=inputs=%d:duration=longest:normalize=0,apad=whole_dur=%.3f,atrim=end=%.3f[aout]'
                  % (''.join('[a%d]' % i for i in range(len(sections))), len(sections), length, length))
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', args.video] + [x for r in report for x in ('-i', r['audio'])] +
        ['-filter_complex', ';'.join(chains), '-map', '[aout]', '-ar', '44100', '-ac', '2', mix])
    track, poster = mux(args.video, mix, args.out, length, args.force)
    summary = {'created_utc': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'script': args.script, 'video': args.video,
               'voice': args.voice, 'model': args.model, 'format': args.format, 'characters_sent': to_send, 'sections': report}
    with open(os.path.splitext(args.out)[0] + '-voiceover.json', 'w') as handle:
        json.dump(summary, handle, indent=2)
    emit(args, dict(summary, confirmed=True, fit=True, out=args.out, track=track, poster=poster),
         ['Wrote %s' % args.out, 'Voiceover track: %s' % track] + (['Poster: %s' % poster] if poster else []) +
         ['%d sections placed, %d sped up (never more than %.0f%%), %d characters sent.' % (len(report), sum(r['fit'] == 'sped_up' for r in report),
                                                                                     (args.max_speedup - 1) * 100, to_send),
          'Sections kept in %s so a re-run only sends what changed. Remove that folder when the video is final.' % work])
    return OK


def cmd_polish(args):
    check_inputs(args)
    need_tools()
    length, take = duration(args.video), duration(args.audio)
    if not length or not take:
        raise Stop('Cannot read the duration of the video or the recording.')
    if args.isolate:
        key()
    work = work_dir(args)
    plan = {'audio': args.audio, 'take_seconds': take, 'video': args.video, 'video_seconds': length, 'out': args.out, 'isolate': args.isolate,
            'normalize': args.normalize, 'trim': take > length + 0.5, 'pad': take < length - 0.5}
    if args.isolate and not args.confirm:
        emit(args, dict(plan, confirmed=False), ['Plan only, nothing was sent.', 'The take (%.1fs) would be cleaned by ElevenLabs, then levelled and placed on the %.1fs video.' % (take, length),
                                                  'Run again with --confirm.'])
        return PLAN_ONLY
    ensure_free([args.out, track_of(args.out)], args.force)
    os.makedirs(work, exist_ok=True)
    source = args.audio
    if args.isolate:
        cleaned = os.path.join(work, 'take-clean-%s.mp3' % hashlib.sha256(read_bytes(args.audio)).hexdigest()[:12])
        if not os.path.isfile(cleaned):
            body, content_type = multipart({}, [('audio', os.path.basename(args.audio), read_bytes(args.audio))])
            status, _, data = call('POST', '/v1/audio-isolation', body=body, content_type=content_type)
            if status != 200 or not data:
                raise Stop('Isolation failed. ' + explain(status, data))
            write_atomic(cleaned, data, True)
        source = cleaned
    filters = (['loudnorm=I=-16:TP=-1.5:LRA=11'] if args.normalize else []) + (['afade=t=out:st=%.3f:d=0.3' % (length - 0.3)] if take > length + 0.5 else [])
    filters += ['apad=whole_dur=%.3f' % length, 'atrim=end=%.3f' % length]
    mix = os.path.join(work, '_mix.wav')
    run(['ffmpeg', '-y', '-loglevel', 'error', '-i', source, '-af', ','.join(filters), '-ar', '44100', '-ac', '2', mix])
    track, poster = mux(args.video, mix, args.out, length, args.force)
    emit(args, dict(plan, confirmed=True, out=args.out, track=track, poster=poster),
         ['Wrote %s' % args.out, 'Voiceover track: %s' % track] + (['Trimmed the take to the video length.'] if plan['trim'] else []))
    return OK


# ---- command line

def text_arg(value):
    if re.search(r'["$`\\\n]', value):
        raise argparse.ArgumentTypeError('may not contain quotes, $, backticks or backslashes')
    return value


def build_parser():
    parser = argparse.ArgumentParser(prog='elevenlabs.py', description='ElevenLabs for the final voiceover of a narrated video.')
    sub = parser.add_subparsers(dest='command', required=True)

    def common(p, voice=False, confirm=False, out=False, work=False):
        p.add_argument('--json', action='store_true', help='print JSON')
        if voice:
            p.add_argument('--voice', type=text_arg, default=os.environ.get('ELEVENLABS_VOICE', ''), help='voice id')
            p.add_argument('--model', type=text_arg, default=os.environ.get('ELEVENLABS_MODEL') or DEFAULT_MODEL)
            p.add_argument('--format', type=text_arg, default=DEFAULT_FORMAT)
        if confirm:
            p.add_argument('--confirm', action='store_true', help='actually send; without it only the plan is printed')
        if out:
            p.add_argument('--out', type=text_arg, required=True)
            p.add_argument('--force', action='store_true', help='replace an existing file')
        if work:
            p.add_argument('--work', type=text_arg, default='', help='where the per-section audio is kept')

    p = sub.add_parser('sections', help='the timed sections of a voiceover script')
    p.add_argument('--script', type=text_arg, required=True)
    p.add_argument('--drop-optional', action='store_true')
    common(p)
    p = sub.add_parser('voices', help='list the voices on the account')
    p.add_argument('--search', type=text_arg, default='')
    p.add_argument('--limit', type=int, default=30)
    common(p)
    p = sub.add_parser('account', help='plan and characters left')
    common(p)
    p = sub.add_parser('speak', help='one text file to one audio file')
    p.add_argument('--text-file', type=text_arg, required=True)
    common(p, voice=True, confirm=True, out=True)
    p = sub.add_parser('isolate', help='remove background noise from a recording')
    p.add_argument('--audio', type=text_arg, required=True)
    common(p, confirm=True, out=True)
    p = sub.add_parser('voiceover', help='speech for every section, fitted to its window, on the approved draft')
    p.add_argument('--script', type=text_arg, required=True)
    p.add_argument('--video', type=text_arg, required=True)
    p.add_argument('--drop-optional', action='store_true')
    p.add_argument('--max-speedup', type=float, default=1.08)
    p.add_argument('--redo', action='store_true', help='ignore the sections already made')
    common(p, voice=True, confirm=True, out=True, work=True)
    p = sub.add_parser('polish', help='level a recorded take and put it on the approved draft')
    p.add_argument('--audio', type=text_arg, required=True)
    p.add_argument('--video', type=text_arg, required=True)
    p.add_argument('--isolate', action='store_true', help='clean the take with ElevenLabs first')
    p.add_argument('--no-normalize', dest='normalize', action='store_false')
    common(p, confirm=True, out=True, work=True)
    return parser


COMMANDS = {'sections': cmd_sections, 'voices': cmd_voices, 'account': cmd_account, 'speak': cmd_speak, 'isolate': cmd_isolate,
            'voiceover': cmd_voiceover, 'polish': cmd_polish}


def main(argv):
    args = build_parser().parse_args(argv)
    if args.command in ('speak', 'voiceover'):
        if not args.voice:
            print('No voice. Pass --voice <id>, or set voice_id in settings.yml (list them: -a voices).', file=sys.stderr)
            return USAGE
        audio_ext(args.format)
    try:
        if args.command in ('speak', 'voiceover'):
            args.voice = resolve_voice(args.voice)
        return COMMANDS[args.command](args)
    except Stop as stop:
        print(stop, file=sys.stderr)
        return stop.code
    except KeyboardInterrupt:
        print('Interrupted. Sections already made are kept.', file=sys.stderr)
        return ERROR


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
