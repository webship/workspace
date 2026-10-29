#!/usr/bin/env python3
"""Voices for the audio workspace: which engines this machine can use, and one text spoken by one of them.

Piper is the local voice of the voice-narration skill: free, offline, no key. ElevenLabs is offered when
a key is set, and what it offers follows what that key is allowed to read. Standard library only.
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True  # importing the engine must not leave a __pycache__ in the tooling tree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import elevenlabs as el  # noqa: E402

OK, ERROR, USAGE = el.OK, el.ERROR, el.USAGE
MODELS = [('eleven_v4', 'Eleven v4: the default'),
          ('eleven_v3', 'Eleven v3: most expressive, 70+ languages'),
          ('eleven_multilingual_v2', 'Multilingual v2: steady and lifelike, 29 languages'),
          ('eleven_flash_v2_5', 'Flash v2.5: fastest, 32 languages, half the credits'),
          ('eleven_turbo_v2_5', 'Turbo v2.5: quick and balanced, 32 languages, half the credits'),
          ('eleven_flash_v2', 'Flash v2: English only, fast, half the credits'),
          ('eleven_turbo_v2', 'Turbo v2: English only, low latency, half the credits')]
CATALOG_LINE = re.compile(r'^  ([ !])(\d+)\) (\S+)\s+(.*)$')
NOT_INSTALLED = ('Piper is not installed where this runs. Install it on the host with the voice-narration skill '
                 '(scripts/install-voice.sh); the dashboard container has none.')


def home(*parts):
    return os.path.join(os.path.expanduser('~'), *parts)


def piper_bin():
    for candidate in (os.environ.get('PIPER_BIN'), home('.local', 'bin', 'piper'), shutil.which('piper')):
        if candidate and os.access(candidate, os.X_OK):
            return candidate
    return None


def voice_dir():
    return os.environ.get('PIPER_VOICE_DIR') or home('.local', 'share', 'piper-voices')


def say_script():
    for candidate in (home('.claude', 'skills', 'voice-narration', 'scripts', 'claude-say'), home('.local', 'bin', 'claude-say')):
        if os.path.isfile(candidate):
            return candidate
    return None


def piper_voices():
    """The voice-narration catalog, in its numbered order, with what is installed marked."""
    voices = []
    script = say_script()
    if script:
        try:
            listing = subprocess.run(['bash', script, 'list'], capture_output=True, text=True, timeout=20).stdout
        except (OSError, subprocess.SubprocessError):
            listing = ''
        for line in listing.splitlines():
            found = CATALOG_LINE.match(line)
            if found:
                voices.append({'id': found.group(3), 'number': int(found.group(2)), 'label': found.group(4).strip(),
                               'installed': os.path.isfile(os.path.join(voice_dir(), found.group(3) + '.onnx'))})
    known = {v['id'] for v in voices}
    try:
        extra = sorted(n[:-5] for n in os.listdir(voice_dir()) if n.endswith('.onnx') and n[:-5] not in known)
    except OSError:
        extra = []
    voices += [{'id': name, 'number': None, 'label': 'Installed', 'installed': True} for name in extra]
    return voices


def write_belongings(out, text, record):
    """What belongs to a generated file, kept beside it: the text it was made from, and how it was made."""
    stem = os.path.splitext(out)[0]
    record = dict(record, file=os.path.basename(out), created_utc=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))
    try:
        el.write_atomic(stem + '.txt', (text.strip() + '\n').encode('utf-8'), True)
        el.write_atomic(stem + '.json', (json.dumps(record, indent=2, ensure_ascii=False) + '\n').encode('utf-8'), True)
    except OSError as error:
        print('The audio was made, but its text and record could not be saved: %s' % error, file=sys.stderr)


def piper_info():
    info = {'id': 'piper', 'label': 'Piper (voice-narration, local)', 'free': True, 'needs_key': False,
            'available': False, 'reason': '', 'reason_code': '', 'voices': [], 'models': []}
    binary = piper_bin()
    voices = piper_voices()
    info['voices'] = voices
    if not binary:
        info.update(reason=NOT_INSTALLED, reason_code='no-binary')
    elif not any(v['installed'] for v in voices):
        info.update(reason='Piper is installed but no voice model is in %s.' % voice_dir(), reason_code='no-voices')
    else:
        info['available'] = True
        info['default_voice'] = next((v['id'] for v in voices if v['installed']), '')
    info['formats'] = ['wav'] + (['mp3'] if shutil.which('ffmpeg') else [])
    return info


def elevenlabs_info():
    info = {'id': 'elevenlabs', 'label': 'ElevenLabs', 'free': False, 'needs_key': True, 'available': False, 'reason': '',
            'voices': [], 'models': [{'id': m, 'label': label} for m, label in MODELS],
            'default_model': os.environ.get('ELEVENLABS_MODEL') or el.DEFAULT_MODEL,
            'default_voice': os.environ.get('ELEVENLABS_VOICE', ''), 'formats': ['mp3'],
            'can_read_account': False, 'can_list_voices': False}
    try:
        el.key()
    except el.Stop as stop:
        info['reason'] = str(stop)
        return info
    try:
        found, why = el.account()
        status, _, body = el.call('GET', '/v2/voices', query={'page_size': '100'})
    except el.Stop as stop:
        info['reason'] = str(stop)
        return info
    if found:
        info.update(can_read_account=True, plan=found['tier'], remaining=found['remaining'], limit=found['limit'])
    else:
        info['account_note'] = why
    if status == 200:
        info['can_list_voices'] = True
        info['voices'] = [{'id': v.get('voice_id'), 'label': v.get('name') or v.get('voice_id'), 'category': v.get('category'),
                           'labels': v.get('labels') or {}} for v in json.loads(body).get('voices', [])]
        # A default given by name (Brian) is the voice whose name starts with it.
        want = info['default_voice'].strip().lower()
        if want and not any(v['id'] == info['default_voice'] for v in info['voices']):
            hit = next((v for v in info['voices'] if (v['label'] or '').lower().startswith(want)), None)
            info['default_voice'] = hit['id'] if hit else ''
    else:
        info['voices_note'] = el.explain(status, body)
    # When the key may read models, any speech model it offers beyond the built-in list is added.
    try:
        listed, _, models = el.call('GET', '/v1/models')
    except el.Stop:
        listed, models = 0, '[]'
    if listed == 200:
        info['can_list_models'] = True
        known = {m['id'] for m in info['models']}
        for m in json.loads(models):
            if m.get('can_do_text_to_speech') and m.get('model_id') and m['model_id'] not in known:
                info['models'].append({'id': m['model_id'], 'label': m.get('name') or m['model_id']})
    # A rejected key fails both reads with 401; a key that only lacks a scope fails with 403 and can still speak.
    if not found and status == 401:
        info['reason'] = 'ElevenLabs rejected the key.'
        return info
    info['available'] = True
    return info


def cmd_engines(args):
    engines = [piper_info(), elevenlabs_info()]
    lines = []
    for e in engines:
        lines.append('%s: %s' % (e['label'], 'available' if e['available'] else 'not available. ' + e['reason']))
        if e['available']:
            lines.append('  %d voices%s' % (len(e['voices']), '' if e['id'] == 'piper' or e['can_list_voices'] else ' (the key cannot list them; pass --voice <id>)'))
            if e.get('remaining') is not None:
                lines.append('  %s characters left on the %s plan' % (e['remaining'], e['plan']))
    el.emit(args, {'engines': engines}, lines)
    return OK


def cmd_voices(args):
    if args.engine == 'elevenlabs':
        return el.main(['voices', '--limit', str(args.limit)] + (['--search', args.search] if args.search else []) + (['--json'] if args.json else []))
    voices = piper_voices()
    lines = ['%-3s %-24s %-9s %s' % ('#', 'voice', 'installed', 'about')] + [
        '%-3s %-24s %-9s %s' % (v['number'] or '', v['id'], 'yes' if v['installed'] else 'no', v['label']) for v in voices]
    el.emit(args, {'voices': voices}, lines)
    return OK


def read_text(path):
    try:
        with open(path, encoding='utf-8') as handle:
            return handle.read().strip()
    except OSError:
        return ''


def cmd_speak(args):
    if not args.out:
        print('Pass --out <file>.', file=sys.stderr)
        return USAGE
    if args.engine == 'elevenlabs':
        argv = ['speak', '--text-file', args.text_file, '--out', args.out, '--voice', args.voice, '--model', args.model]
        code = el.main(argv + (['--confirm'] if args.confirm else []) + (['--force'] if args.force else []) + (['--json'] if args.json else []))
        if code == OK:
            write_belongings(args.out, read_text(args.text_file), {'kind': 'voice', 'engine': 'elevenlabs', 'voice': args.voice, 'model': args.model})
        return code
    return speak_piper(args)


def speak_piper(args):
    text = read_text(args.text_file)
    if not text:
        print('The text file is missing or empty: %s' % args.text_file, file=sys.stderr)
        return USAGE
    binary = piper_bin()
    if not binary:
        print(NOT_INSTALLED, file=sys.stderr)
        return ERROR
    installed = [v['id'] for v in piper_voices() if v['installed']]
    voice = args.voice or (installed[0] if installed else '')
    model = os.path.join(voice_dir(), voice + '.onnx')
    if not voice or not os.path.isfile(model):
        print('The Piper voice "%s" is not installed. Installed: %s.' % (voice, ', '.join(installed) or 'none'), file=sys.stderr)
        return USAGE
    ext = os.path.splitext(args.out)[1].lower()
    if ext not in ('.wav', '.mp3'):
        print('Piper writes .wav, or .mp3 when ffmpeg is installed. Use one of those for --out.', file=sys.stderr)
        return USAGE
    if ext == '.mp3' and not shutil.which('ffmpeg'):
        print('ffmpeg is not installed here, so Piper cannot make an mp3. Use a .wav name.', file=sys.stderr)
        return USAGE
    try:
        el.ensure_free([args.out], args.force)
    except el.Stop as stop:
        print(stop, file=sys.stderr)
        return stop.code
    wav = args.out if ext == '.wav' else args.out + '.tmp.wav'
    try:
        subprocess.run([binary, '--model', model, '--output_file', wav], input=text.encode('utf-8'), capture_output=True, check=True, timeout=300)
        if ext == '.mp3':
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', args.out], check=True, timeout=300)
    except (OSError, subprocess.SubprocessError) as error:
        print('Piper failed: %s' % getattr(error, 'stderr', error), file=sys.stderr)
        return ERROR
    finally:
        if wav != args.out and os.path.exists(wav):
            os.remove(wav)
    write_belongings(args.out, text, {'kind': 'voice', 'engine': 'piper', 'voice': voice})
    el.emit(args, {'engine': 'piper', 'voice': voice, 'characters': len(text), 'out': args.out},
            ['Wrote %s (voice %s, %d characters).' % (args.out, voice, len(text))])
    return OK


def piper_synthesize(text, voice, model, fmt):
    """The engine's synthesize(), spoken by Piper: one section in, mp3 bytes out."""
    binary = piper_bin()
    if not binary:
        raise el.Stop(NOT_INSTALLED)
    path = os.path.join(voice_dir(), voice + '.onnx')
    if not os.path.isfile(path):
        raise el.Stop('The Piper voice "%s" is not installed.' % voice, USAGE)
    with tempfile.TemporaryDirectory() as work:
        wav, mp3 = os.path.join(work, 's.wav'), os.path.join(work, 's.mp3')
        try:
            subprocess.run([binary, '--model', path, '--output_file', wav], input=text.encode('utf-8'), capture_output=True, check=True, timeout=300)
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3], check=True, timeout=300)
        except (OSError, subprocess.SubprocessError) as error:
            raise el.Stop('Piper failed: %s' % getattr(error, 'stderr', error))
        with open(mp3, 'rb') as handle:
            return handle.read(), {'engine': 'piper', 'voice': voice}


def timed_script(path, video):
    """The script the engine reads. A transcript with no timed sections is spread over the whole video."""
    text = read_text(path)
    if not text:
        raise el.Stop('The script is missing or empty: %s' % path, USAGE)
    if any(el.HEADING.match(line) for line in text.splitlines()):
        return path, None
    length = el.duration(video)
    if not length:
        raise el.Stop('Cannot read the video duration: %s' % video)
    lines = [re.sub(r'^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)', '', line).strip() for line in text.splitlines()]
    spoken = [line for line in lines if line and not line.startswith('#')]
    if not spoken:
        raise el.Stop('The script has nothing to say: %s' % path, USAGE)
    work = tempfile.mkdtemp(prefix='ws-voice-script-')
    timed = os.path.join(work, 'script.md')
    with open(timed, 'w', encoding='utf-8') as handle:
        handle.write('## S01 Narration (00:00.0 to %s)\n\n%s\n' % (el.mmss(length), '\n'.join('> ' + line for line in spoken)))
    return timed, work


def cmd_voiceover(args):
    if args.engine == 'piper':
        installed = [v['id'] for v in piper_voices() if v['installed']]
        args.voice = args.voice or (installed[0] if installed else '')
        if not piper_bin() or args.voice not in installed:
            print(NOT_INSTALLED if not piper_bin() else 'The Piper voice "%s" is not installed. Installed: %s.' % (args.voice, ', '.join(installed) or 'none'), file=sys.stderr)
            return USAGE if piper_bin() else ERROR
        # Piper is local and free: no key, no credits, and the engine's section loop speaks through it.
        el.key = lambda: ''
        el.remaining_characters = lambda: None
        el.synthesize = piper_synthesize
        el.resolve_voice = lambda value: value  # a Piper voice is never looked up on ElevenLabs
        args.model = 'piper'
    script, work = timed_script(args.script, args.video)
    try:
        argv = ['voiceover', '--script', script, '--video', args.video, '--out', args.out, '--voice', args.voice, '--model', args.model]
        flags = [f for on, f in ((args.confirm, '--confirm'), (args.force, '--force'), (args.json, '--json'), (args.drop_optional, '--drop-optional')) if on]
        return el.main(argv + flags)
    finally:
        if work:
            shutil.rmtree(work, ignore_errors=True)


SOUND_FORMAT = 'mp3_44100_128'


def _generate(args, endpoint, body, label, plan, text):
    """A sound or a piece of music from ElevenLabs: plan first, send only with --confirm."""
    el.key()
    plan = dict(plan, remaining=el.remaining_characters(), out=args.out)
    if not args.confirm:
        el.emit(args, dict(plan, confirmed=False), ['Plan only, nothing was sent.'] + ['%s: %s' % kv for kv in plan.items() if kv[0] != 'remaining']
                + ['Credits left: %s.' % ('unknown' if plan['remaining'] is None else plan['remaining']), 'Run again with --confirm to create %s.' % args.out])
        return el.PLAN_ONLY
    el.ensure_free([args.out], args.force)
    status, _, data = el.call('POST', endpoint, body=json.dumps(body).encode(), content_type='application/json', query={'output_format': SOUND_FORMAT})
    if status != 200:
        raise el.Stop('%s failed. %s' % (label, el.explain(status, data)))
    el.write_atomic(args.out, data, args.force)
    write_belongings(args.out, text, {'kind': plan['kind'], 'engine': 'elevenlabs', **{k: v for k, v in plan.items() if k not in ('kind', 'remaining', 'out', 'prompt')}})
    el.emit(args, dict(plan, confirmed=True, bytes=len(data)), ['Wrote %s (%d bytes).' % (args.out, len(data))])
    return OK


def cmd_sound(args):
    text = read_text(args.text_file)
    if not text:
        print('The description is missing or empty: %s' % args.text_file, file=sys.stderr)
        return USAGE
    if args.duration is not None and not 0.5 <= args.duration <= 30:
        print('A sound runs from 0.5 to 30 seconds.', file=sys.stderr)
        return USAGE
    if not 0 <= args.influence <= 1:
        print('--influence is between 0 and 1.', file=sys.stderr)
        return USAGE
    body = {'text': text, 'prompt_influence': args.influence}
    if args.duration is not None:
        body['duration_seconds'] = args.duration
    if args.loop:
        body['loop'] = True
    return _generate(args, '/v1/sound-generation', body, 'Sound generation',
                     {'kind': 'sound', 'prompt': text[:120], 'duration': args.duration if args.duration is not None else 'chosen by ElevenLabs', 'loop': args.loop}, text)


def cmd_music(args):
    text = read_text(args.text_file)
    if not text:
        print('The description is missing or empty: %s' % args.text_file, file=sys.stderr)
        return USAGE
    if not 3 <= args.length <= 600:
        print('Music runs from 3 to 600 seconds.', file=sys.stderr)
        return USAGE
    body = {'prompt': text, 'music_length_ms': int(round(args.length * 1000)), 'force_instrumental': bool(args.instrumental)}
    return _generate(args, '/v1/music', body, 'Music generation',
                     {'kind': 'music', 'prompt': text[:120], 'seconds': args.length, 'instrumental': args.instrumental}, text)


def build_parser():
    parser = argparse.ArgumentParser(prog='voice.py', description='Voices for the audio workspace.')
    sub = parser.add_subparsers(dest='command', required=True)
    engines = sub.add_parser('engines', help='the engines this machine can use')
    engines.add_argument('--json', action='store_true')
    voices = sub.add_parser('voices', help='the voices of one engine')
    voices.add_argument('--engine', choices=('piper', 'elevenlabs'), required=True)
    voices.add_argument('--search', type=el.text_arg, default='')
    voices.add_argument('--limit', type=int, default=30)
    voices.add_argument('--json', action='store_true')
    speak = sub.add_parser('speak', help='one text, one file')
    speak.add_argument('--engine', choices=('piper', 'elevenlabs'), required=True)
    speak.add_argument('--text-file', type=el.text_arg, required=True)
    speak.add_argument('--out', type=el.text_arg, required=True)
    speak.add_argument('--voice', type=el.text_arg, default='')
    speak.add_argument('--model', type=el.text_arg, default=os.environ.get('ELEVENLABS_MODEL') or el.DEFAULT_MODEL)
    speak.add_argument('--confirm', action='store_true', help='ElevenLabs only: actually send; without it only the plan is printed')
    speak.add_argument('--force', action='store_true')
    speak.add_argument('--json', action='store_true')
    sound = sub.add_parser('sound', help='a sound effect from a description (ElevenLabs)')
    sound.add_argument('--text-file', type=el.text_arg, required=True)
    sound.add_argument('--out', type=el.text_arg, required=True)
    sound.add_argument('--duration', type=float, default=None, help='0.5 to 30 seconds; left out, ElevenLabs chooses')
    sound.add_argument('--loop', action='store_true', help='a sound that repeats without a seam')
    sound.add_argument('--influence', type=float, default=0.3, help='how closely to follow the description, 0 to 1')
    sound.add_argument('--confirm', action='store_true')
    sound.add_argument('--force', action='store_true')
    sound.add_argument('--json', action='store_true')
    music = sub.add_parser('music', help='music from a description (ElevenLabs)')
    music.add_argument('--text-file', type=el.text_arg, required=True)
    music.add_argument('--out', type=el.text_arg, required=True)
    music.add_argument('--length', type=float, default=30, help='3 to 600 seconds')
    music.add_argument('--instrumental', action='store_true', help='no vocals')
    music.add_argument('--confirm', action='store_true')
    music.add_argument('--force', action='store_true')
    music.add_argument('--json', action='store_true')
    over = sub.add_parser('voiceover', help='a script, spoken over a video')
    over.add_argument('--engine', choices=('piper', 'elevenlabs'), required=True)
    over.add_argument('--script', type=el.text_arg, required=True)
    over.add_argument('--video', type=el.text_arg, required=True)
    over.add_argument('--out', type=el.text_arg, required=True)
    over.add_argument('--voice', type=el.text_arg, default='')
    over.add_argument('--model', type=el.text_arg, default=os.environ.get('ELEVENLABS_MODEL') or el.DEFAULT_MODEL)
    over.add_argument('--confirm', action='store_true')
    over.add_argument('--force', action='store_true')
    over.add_argument('--drop-optional', action='store_true')
    over.add_argument('--json', action='store_true')
    return parser


def main(argv):
    args = build_parser().parse_args(argv)
    if args.command in ('speak', 'voiceover') and args.engine == 'elevenlabs' and not args.voice:
        args.voice = os.environ.get('ELEVENLABS_VOICE', '')
        if not args.voice:
            print('No ElevenLabs voice. Pass --voice <id>, or set voice_id in settings.yml (list them: -a voices --engine elevenlabs).', file=sys.stderr)
            return USAGE
    try:
        return {'engines': cmd_engines, 'voices': cmd_voices, 'speak': cmd_speak, 'voiceover': cmd_voiceover,
                'sound': cmd_sound, 'music': cmd_music}[args.command](args)
    except el.Stop as stop:
        print(stop, file=sys.stderr)
        return stop.code


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
