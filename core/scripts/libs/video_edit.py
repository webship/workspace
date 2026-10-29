#!/usr/bin/env python3
"""Edit a video into a NEW version of itself: cut, speed up or slow down, add a section, drop a section,
open and close with the Vardot logo, and put music under either end. Standard library plus ffmpeg.

The video it starts from is never changed. A change is described as a timeline of pieces (a stretch of the
source, or a card with the logo), one ffmpeg run builds it, and the timed voiceover script beside the video is
rewritten so every section still points at the same words in the new one.
Exit codes: 0 ok, 1 error, 2 usage, 3 no key, 4 plan only.
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

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import elevenlabs as el  # noqa: E402

OK, ERROR, USAGE, PLAN_ONLY = el.OK, el.ERROR, el.USAGE, el.PLAN_ONLY
MIN_SPEED, MAX_SPEED = 0.25, 4.0
CARD_SECONDS = (1.0, 10.0)
SECTION_PAD = 0.8
FADE_IN, FADE_OUT = 0.6, 1.8
BRAND_BG = '#2b447c'
CHROME = ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser')


def workspace_root():
    return os.environ.get('WORKSPACE_ROOT') or os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..'))


def public_dir():
    return os.path.join(workspace_root(), 'core', 'workspace-app', 'public')


# ---- the timeline: pieces in order, and where a moment of the source ends up --------------------------

class Piece:
    """A stretch of the source video (`kind` source), or a card shown for `seconds` (`kind` card)."""

    def __init__(self, kind, start=0.0, end=0.0, speed=1.0, seconds=0.0, title='', subtitle='', audio=None, src=0):
        # src 0 is the video being edited; 1.. are videos a section was borrowed from (their own clock)
        self.kind, self.start, self.end, self.speed, self.src = kind, start, end, speed, src
        self.seconds, self.title, self.subtitle, self.audio = seconds, title, subtitle, audio
        self.out_start = 0.0

    @property
    def length(self):
        return (self.end - self.start) / self.speed if self.kind == 'source' else self.seconds


def lay_out(pieces):
    at = 0.0
    for piece in pieces:
        piece.out_start = at
        at += piece.length
    return at


def source_pieces(total, cuts, speed):
    """The source with the `cuts` (start, end) taken out, every kept stretch at `speed`."""
    kept, at = [], 0.0
    for start, end in sorted(cuts):
        start, end = max(0.0, start), min(total, end)
        if end <= start:
            continue
        if start > at:
            kept.append((at, start))
        at = max(at, end)
    if at < total:
        kept.append((at, total))
    return [Piece('source', a, b, speed) for a, b in kept if b - a > 0.04]


# ---- the script: timed sections the way the voiceover tools read them -------------------------------

def section_heading(sid, title, start, end):
    return '## %s %s (%s to %s)' % (sid, title, el.mmss(start), el.mmss(end))


def parse_blocks(text):
    """The script as a preamble and a list of sections {id, title, start, end, lines}."""
    pre, sections, current = [], [], None
    for line in text.splitlines():
        found = el.HEADING.match(line)
        if found:
            current = {'id': found.group(1), 'title': found.group(2), 'start': el.seconds_of(found.group(3)),
                       'end': el.seconds_of(found.group(4)), 'lines': []}
            sections.append(current)
        elif line.startswith('## '):
            current = {'id': None, 'lines': [line]}
            sections.append(current)
        elif current is None:
            pre.append(line)
        else:
            current['lines'].append(line)
    return pre, sections


def retime_script(text, pieces, added=()):
    """The script for the new video. A section cut away is dropped; one cut in part is shortened; the rest
    follow their words to where the pieces put them. `added` sections (dicts with after, id, title, lines)
    go in where their card now is. Anything that is not a timed section is kept where it was."""
    pre, sections = parse_blocks(text)
    out = list(pre)
    placed = {}
    for a in added:
        placed.setdefault(a['after'], []).append(a)
    for a in placed.pop('start', []):
        out += card_section_lines(a, pieces)
    for section in sections:
        if section['id'] is None:
            out += section['lines']
            continue
        inside = [p for p in pieces if p.kind == 'source' and p.src == 0 and p.end > section['start'] + 1e-6 and p.start < section['end'] - 1e-6]
        if inside:
            start = min(p.out_start + (max(p.start, section['start']) - p.start) / p.speed for p in inside)
            end = max(p.out_start + (min(p.end, section['end']) - p.start) / p.speed for p in inside)
            out += [section_heading(section['id'], section['title'], start, end)] + section['lines']
        for a in placed.pop(section['id'], []):
            out += card_section_lines(a, pieces)
    for a in placed.pop('end', []):
        out += card_section_lines(a, pieces)
    for rest in placed.values():
        for a in rest:
            out += card_section_lines(a, pieces)
    text = '\n'.join(out).rstrip('\n') + '\n'
    return re.sub(r'\n{3,}', '\n\n', text)


def card_section_lines(added, pieces):
    span = added.get('pieces') or [added['card']]
    start, end = span[0].out_start, span[-1].out_start + span[-1].length
    body = list(added['lines']) if added.get('lines') else ['> ' + added['text']]
    while body and not body[-1].strip():
        body.pop()
    return ['', section_heading(added['id'], added['title'], start, end)] + body + ['']


def free_section_id(sections, prefix='N'):
    taken = {s['id'] for s in sections if s['id']}
    number = 1
    while '%s%02d' % (prefix, number) in taken:
        number += 1
    return '%s%02d' % (prefix, number)


# ---- reading the video ------------------------------------------------------------------------------

def probe(path):
    done = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate',
                           '-show_entries', 'format=duration', '-of', 'json', path], capture_output=True, text=True, timeout=60)
    try:
        data = json.loads(done.stdout)
    except ValueError:
        raise el.Stop('Cannot read the video: %s' % path)
    video = next((s for s in data.get('streams', []) if s.get('codec_type') == 'video'), None)
    if not video:
        raise el.Stop('There is no picture in %s.' % path)
    num, _, den = (video.get('r_frame_rate') or '30/1').partition('/')
    fps = float(num) / float(den or 1) if float(den or 1) else 30.0
    return {'width': int(video['width']) // 2 * 2, 'height': int(video['height']) // 2 * 2, 'fps': round(fps, 3) if 1 <= fps <= 120 else 30.0,
            'duration': float(data['format']['duration']), 'has_audio': any(s.get('codec_type') == 'audio' for s in data.get('streams', []))}


def parse_range(value):
    found = re.match(r'^\s*([\d:.]+)\s*-\s*([\d:.]+)\s*$', value or '')
    if not found:
        raise el.Stop('A range is "start-end", in seconds or minutes:seconds, like 0:05-0:40.', USAGE)
    return el.seconds_of(found.group(1)), el.seconds_of(found.group(2))


# ---- cards: the Vardot logo, and words, as a picture ------------------------------------------------

def chrome():
    for name in CHROME:
        found = shutil.which(name)
        if found:
            return found
    raise el.Stop('A card needs Chrome or Chromium on this machine, and none was found.')


def card_html(title, subtitle, width, height):
    pub = public_dir()
    fonts = os.path.join(pub, 'vendor', 'fonts')
    logo = os.path.join(pub, 'vardot-logo-on-dark.svg')
    if not os.path.isfile(logo):
        raise el.Stop('The Vardot logo is missing: %s' % logo)
    esc = lambda s: s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')  # noqa: E731
    scale = height / 720.0
    return ('<!doctype html><meta charset="utf-8"><style>'
            '@font-face{font-family:Figtree;font-weight:600;src:url("file://%(f)s/figtree-latin-600-normal.woff2")}'
            '@font-face{font-family:Figtree;font-weight:400;src:url("file://%(f)s/figtree-latin-400-normal.woff2")}'
            'html,body{margin:0;width:%(w)dpx;height:%(h)dpx;background:%(bg)s;display:flex;flex-direction:column;align-items:center;'
            'justify-content:center;font-family:Figtree,sans-serif;text-align:center;overflow:hidden}'
            'img{width:%(logo)dpx}h1{color:#fff;font-weight:600;font-size:%(t)dpx;margin:%(gap)dpx 8%% 0;line-height:1.25}'
            'p{color:#deedff;font-size:%(s)dpx;margin:%(gap2)dpx 8%% 0;line-height:1.35}</style>'
            '<img src="file://%(logo_file)s">%(h1)s%(p)s'
            % {'f': fonts, 'w': width, 'h': height, 'bg': BRAND_BG, 'logo': int(420 * scale), 't': int(44 * scale), 's': int(26 * scale),
               'gap': int(40 * scale), 'gap2': int(10 * scale), 'logo_file': logo,
               'h1': '<h1>%s</h1>' % esc(title) if title else '', 'p': '<p>%s</p>' % esc(subtitle) if subtitle else ''})


def render_card(path, title, subtitle, width, height):
    page = path + '.html'
    with open(page, 'w', encoding='utf-8') as handle:
        handle.write(card_html(title, subtitle, width, height))
    profile = tempfile.mkdtemp(prefix='ws-card-profile-')
    try:
        done = subprocess.run([chrome(), '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                               '--user-data-dir=' + profile, '--window-size=%d,%d' % (width, height), '--screenshot=' + path, 'file://' + page],
                              capture_output=True, text=True, timeout=120)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if not os.path.isfile(path):
        raise el.Stop('The card was not drawn: %s' % ((done.stderr or '').strip().splitlines()[-1:] or 'no output'))


# ---- building it ------------------------------------------------------------------------------------

def atempo_chain(speed):
    """atempo takes 0.5 to 2 in older builds; chain it so any speed in range works."""
    chain, rest = [], speed
    while rest > 2.0:
        chain.append(2.0)
        rest /= 2.0
    while rest < 0.5:
        chain.append(0.5)
        rest /= 0.5
    chain.append(rest)
    return ','.join('atempo=%.5f' % f for f in chain)


def build_filters(pieces, info, music_in, music_out, volume, cards):
    """The ffmpeg inputs and filter graph for the timeline. `cards` maps a card piece to its picture."""
    extras = info.get('extra', [])
    inputs, chains, labels = [], [], []
    count = [0]

    def add(*flags):
        inputs.extend(flags)
        count[0] += 1
        return count[0] - 1

    w, h, fps = info['width'], info['height'], info['fps']
    fmt = 'aformat=sample_rates=44100:channel_layouts=stereo'
    for i, piece in enumerate(pieces):
        if piece.kind == 'source':
            origin = info if piece.src == 0 else extras[piece.src - 1]
            has_audio = origin['has_audio']
            # every stretch is its own seeked input of the file: one input split into many trims makes ffmpeg
            # hold the whole rest of the video in memory while the timeline waits on an earlier piece
            n = add('-ss', '%.3f' % piece.start, '-t', '%.3f' % (piece.end - piece.start), '-i', origin['path'])
            # a borrowed picture keeps its own shape: fitted inside this video's frame, never stretched
            fit = ('scale=%d:%d' % (w, h)) if piece.src == 0 else \
                  ('scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:color=black' % (w, h, w, h))
            chains.append('[%d:v]setpts=(PTS-STARTPTS)/%.5f,%s,fps=%.3f,format=yuv420p,setsar=1[v%d]'
                          % (n, piece.speed, fit, fps, i))
            if has_audio:
                tempo = ',' + atempo_chain(piece.speed) if abs(piece.speed - 1.0) > 1e-6 else ''
                chains.append('[%d:a]asetpts=PTS-STARTPTS%s,%s,apad=whole_dur=%.3f,atrim=end=%.3f,asetpts=PTS-STARTPTS[a%d]'
                              % (n, tempo, fmt, piece.length, piece.length, i))
            else:
                chains.append('anullsrc=r=44100:cl=stereo,atrim=duration=%.3f,%s[a%d]' % (piece.length, fmt, i))
        else:
            n = add('-loop', '1', '-framerate', '%.3f' % fps, '-t', '%.3f' % piece.seconds, '-i', cards[id(piece)])
            chains.append('[%d:v]scale=%d:%d,fps=%.3f,format=yuv420p,setsar=1[v%d]' % (n, w, h, fps, i))
            if piece.audio:
                m = add('-i', piece.audio)
                chains.append('[%d:a]%s,apad=whole_dur=%.3f,atrim=end=%.3f,asetpts=PTS-STARTPTS[a%d]' % (m, fmt, piece.seconds, piece.seconds, i))
            else:
                chains.append('anullsrc=r=44100:cl=stereo,atrim=duration=%.3f,%s[a%d]' % (piece.seconds, fmt, i))
        labels.append('[v%d][a%d]' % (i, i))
    total = sum(p.length for p in pieces)
    chains.append('%sconcat=n=%d:v=1:a=1[vout][amain]' % (''.join(labels), len(pieces)))
    mixes, names = [], ['[amain]']
    for tag, music, at_end in (('in', music_in, False), ('out', music_out, True)):
        if not music:
            continue
        path, length = music
        length = min(length, total)
        n = add('-i', path)
        delay = max(0.0, total - length) if at_end else 0.0
        mixes.append('[%d:a]%s,atrim=end=%.3f,asetpts=PTS-STARTPTS,volume=%.3f,afade=t=in:st=0:d=%.2f,afade=t=out:st=%.3f:d=%.2f,adelay=%d:all=1[m%s]'
                     % (n, fmt, length, volume, min(FADE_OUT if at_end else FADE_IN, length / 2), max(0.0, length - FADE_OUT), min(FADE_OUT, length),
                        int(delay * 1000), tag))
        names.append('[m%s]' % tag)
    if mixes:
        chains += mixes
        chains.append('%samix=inputs=%d:duration=first:normalize=0[aout]' % (''.join(names), len(names)))
    else:
        chains.append('[amain]anull[aout]')
    return inputs, ';'.join(chains), total


def speaker(engine, voice, model, confirm):
    """A function that speaks a text and returns the mp3 bytes."""
    import voice as vo  # noqa: E402
    if engine == 'piper':
        installed = [v['id'] for v in vo.piper_voices() if v['installed']]
        voice = voice or (installed[0] if installed else '')
        if not vo.piper_bin() or voice not in installed:
            raise el.Stop(vo.NOT_INSTALLED if not vo.piper_bin() else 'The Piper voice "%s" is not installed. Installed: %s.' % (voice, ', '.join(installed) or 'none'), USAGE)
        return lambda text: vo.piper_synthesize(text, voice, '', 'mp3')[0]
    el.key()
    if not voice:
        raise el.Stop('Choose an ElevenLabs voice for the new section.', USAGE)
    voice_id = el.resolve_voice(voice)
    return lambda text: el.synthesize(text, voice_id, model or el.DEFAULT_MODEL, el.DEFAULT_FORMAT)[0]


# ---- the command ------------------------------------------------------------------------------------

def cmd_info(args):
    info = probe(args.video)
    el.emit(args, dict(info, path=args.video), ['%dx%d at %s fps, %s long, %s' % (info['width'], info['height'], info['fps'], el.mmss(info['duration']),
                                                                                  'with sound' if info['has_audio'] else 'silent')])
    return OK


def plan_edit(args, info, script_text):
    """The pieces the options ask for, and a description of each change for the record."""
    total = info['duration']
    cuts, changes = [], []
    if args.trim:
        start, end = parse_range(args.trim)
        if not 0 <= start < end <= total + 0.5:
            raise el.Stop('The trim %s is outside the video, which is %s long.' % (args.trim, el.mmss(total)), USAGE)
        cuts += [(0.0, start), (end, total)]
        changes.append('trimmed to %s-%s' % (el.mmss(start), el.mmss(end)))
    if args.remove:
        if not script_text:
            raise el.Stop('Removing a section needs the video\'s timed voiceover script.', USAGE)
        _, sections = parse_blocks(script_text)
        by_id = {s['id']: s for s in sections if s['id']}
        for sid in [x for x in args.remove.split(',') if x.strip()]:
            if sid.strip() not in by_id:
                raise el.Stop('The script has no section "%s". It has: %s.' % (sid.strip(), ', '.join(by_id) or 'none'), USAGE)
            cuts.append((by_id[sid.strip()]['start'], by_id[sid.strip()]['end']))
            changes.append('removed section %s' % sid.strip())
    speed = args.speed or 1.0
    pieces = source_pieces(total, cuts, 1.0)
    if not pieces:
        raise el.Stop('Nothing is left of the video after those cuts.', USAGE)
    if args.length:
        kept = sum(p.end - p.start for p in pieces)
        target = el.seconds_of(args.length) if ':' in args.length else float(args.length)
        speed = kept / target
        if not MIN_SPEED <= speed <= MAX_SPEED:
            raise el.Stop('To fit %s the picture would play at %.2fx; the range is %.2fx to %.0fx. Longest possible: %s, shortest: %s.'
                          % (el.mmss(target), speed, MIN_SPEED, MAX_SPEED, el.mmss(kept / MIN_SPEED), el.mmss(kept / MAX_SPEED)), USAGE)
    if not MIN_SPEED <= speed <= MAX_SPEED:
        raise el.Stop('Speed goes from %.2fx to %.0fx.' % (MIN_SPEED, MAX_SPEED), USAGE)
    for piece in pieces:
        piece.speed = speed
    if abs(speed - 1.0) > 1e-6:
        changes.append('at %.2fx speed' % speed)
    return pieces, changes


def insert_pieces(pieces, script_text, where, new, taken_at_start=0):
    """Put `new` pieces at `where`: start, end, or after the section of the edited video with that id. The source
    piece a section ends inside is split so the new pieces land exactly after it. Returns the index they went to."""
    if where == 'start':
        pieces[taken_at_start:taken_at_start] = new
        return taken_at_start
    if where == 'end' or not script_text:
        pieces.extend(new)
        return len(pieces) - len(new)
    end = next(s['end'] for s in parse_blocks(script_text)[1] if s['id'] == where)
    at = max((i + 1 for i, p in enumerate(pieces) if p.kind == 'source' and p.src == 0 and p.start < end - 1e-6), default=len(pieces))
    for i, p in enumerate(pieces):
        if p.kind == 'source' and p.src == 0 and p.start + 1e-6 < end < p.end - 1e-6:
            pieces[i:i + 1] = [Piece('source', p.start, end, p.speed), Piece('source', end, p.end, p.speed)]
            at = i + 1
            break
    # several things going after one section keep the order they were asked for
    while at < len(pieces) and (pieces[at].kind == 'card' or pieces[at].src > 0):
        at += 1
    pieces[at:at] = new
    return at


def parse_borrow(spec):
    """`VIDEO|SECTION-or-START-END|AFTER|SCRIPT`: the last two parts are optional."""
    parts = [x.strip() for x in (spec or '').split('|')]
    if len(parts) < 2 or not parts[0] or not parts[1] or len(parts) > 4:
        raise el.Stop('--borrow is VIDEO|SECTION|AFTER|SCRIPT, like clip.mp4|T03|end|clip-voiceover-script.md (the last two are optional). '
                      'SECTION is a section id of that video\'s script, or a range like 0:10-0:30.', USAGE)
    parts += [''] * (4 - len(parts))
    return {'video': parts[0], 'what': parts[1], 'after': parts[2] or 'end', 'script': parts[3]}


def plan_borrows(args, script_text, sources):
    """Borrowed stretches from other videos: a list of {pieces, after, section, title, lines, from} and the
    `sources` list (each {path, has_audio, ...}) the pieces' `src` numbers point into."""
    out = []
    own = [s['id'] for s in parse_blocks(script_text)[1] if s['id']] if script_text else []
    for raw in args.borrow or []:
        spec = parse_borrow(raw)
        if os.path.abspath(spec['video']) == os.path.abspath(args.video):
            raise el.Stop('A section borrowed from the video itself is already there: copy it by editing the video, or borrow from another.', USAGE)
        if not os.path.isfile(spec['video']):
            raise el.Stop('The video to borrow from is missing: %s' % spec['video'], USAGE)
        if spec['after'] not in ('start', 'end') and spec['after'] not in own:
            raise el.Stop('Cannot put it after "%s": %s' % (spec['after'], 'this video has sections ' + ', '.join(own) if own else
                          'this video has no timed script, so only start or end'), USAGE)
        index = next((i for i, s in enumerate(sources) if s['path'] == spec['video']), None)
        if index is None:
            info = probe(spec['video'])
            info['path'] = spec['video']
            sources.append(info)
            index = len(sources) - 1
        info = sources[index]
        title, lines, label = '', [], spec['what']
        if re.match(r'^[\d:.]+\s*-\s*[\d:.]+$', spec['what']):
            start, end = parse_range(spec['what'])
            title = 'Borrowed %s-%s' % (el.mmss(start), el.mmss(end))
        else:
            if not spec['script']:
                raise el.Stop('A section id needs the script of %s: add it as the fourth part of --borrow, or borrow a range like 0:10-0:30.'
                              % os.path.basename(spec['video']), USAGE)
            try:
                with open(spec['script'], encoding='utf-8') as handle:
                    theirs = parse_blocks(handle.read())[1]
            except OSError as error:
                raise el.Stop('Cannot read the script of the video to borrow from: %s' % error, USAGE)
            found = next((s for s in theirs if s['id'] == spec['what']), None)
            if not found:
                raise el.Stop('%s has no section "%s". It has: %s.' % (os.path.basename(spec['script']), spec['what'],
                              ', '.join(s['id'] for s in theirs if s['id']) or 'none'), USAGE)
            start, end, title, lines = found['start'], found['end'], found['title'], found['lines']
        if not 0 <= start < end <= info['duration'] + 0.5:
            raise el.Stop('%s-%s is outside %s, which is %s long.' % (el.mmss(start), el.mmss(end), os.path.basename(spec['video']), el.mmss(info['duration'])), USAGE)
        out.append({'pieces': [Piece('source', start, min(end, info['duration']), 1.0, src=index + 1)], 'after': spec['after'], 'what': label,
                    'title': title, 'lines': lines, 'from': os.path.basename(spec['video'])})
    return out


STRING_OPTIONS = ('add_title', 'add_subtitle', 'add_text', 'intro_title', 'intro_subtitle', 'outro_title', 'outro_subtitle')


def read_strings(args):
    if not args.strings_file:
        return
    try:
        with open(args.strings_file, encoding='utf-8') as handle:
            given = json.load(handle)
    except (OSError, ValueError) as error:
        raise el.Stop('Cannot read the strings file: %s' % error, USAGE)
    for name in STRING_OPTIONS:
        if isinstance(given.get(name), str):
            setattr(args, name, given[name].strip())


def cmd_edit(args):
    read_strings(args)
    el.need_tools()
    info = probe(args.video)
    info['path'] = args.video
    info['extra'] = []
    script_text = ''
    if args.script:
        try:
            with open(args.script, encoding='utf-8') as handle:
                script_text = handle.read()
        except OSError as error:
            raise el.Stop('Cannot read the script: %s' % error, USAGE)
    pieces, changes = plan_edit(args, info, script_text)
    added = []
    work = tempfile.mkdtemp(prefix='ws-video-edit-')
    try:
        # an added section: a card with the Vardot logo and a title, spoken by the chosen voice
        if args.add_text:
            if not args.add_title:
                raise el.Stop('A new section needs a title.', USAGE)
            where = args.add_after or 'end'
            if script_text and where not in ('start', 'end') and where not in {s['id'] for s in parse_blocks(script_text)[1] if s['id']}:
                raise el.Stop('The script has no section "%s" to add after.' % where, USAGE)
            engine = args.engine or 'piper'
            if engine == 'elevenlabs' and not args.confirm:
                chars = len(args.add_text)
                el.emit(args, {'plan': 'new section', 'characters_to_send': chars, 'voice': args.voice, 'confirmed': False},
                        ['Plan only, nothing was sent.', 'The new section "%s" would send %d characters to ElevenLabs (voice %s).' % (args.add_title, chars, args.voice),
                         'Run again with --confirm to make the video.'])
                return PLAN_ONLY
            say = speaker(engine, args.voice, args.model, args.confirm)
            speech = os.path.join(work, 'section.mp3')
            with open(speech, 'wb') as handle:
                handle.write(say(args.add_text))
            spoken = el.duration(speech) or 0.0
            card = Piece('card', seconds=round(spoken + SECTION_PAD, 2), title=args.add_title, subtitle=args.add_subtitle or '', audio=speech)
            insert_pieces(pieces, script_text, where, [card])
            sections = parse_blocks(script_text)[1] if script_text else []
            added.append({'after': where if script_text else 'end', 'id': free_section_id(sections), 'title': args.add_title, 'text': args.add_text, 'card': card})
            changes.append('added section "%s"' % args.add_title)
        sections_now = parse_blocks(script_text)[1] if script_text else []
        borrowed = plan_borrows(args, script_text, info['extra'])
        start_slot = 0
        for item in borrowed:
            at = insert_pieces(pieces, script_text, item['after'], item['pieces'], start_slot)
            if item['after'] == 'start':
                start_slot = at + len(item['pieces'])
            taken = sections_now + [{'id': a['id']} for a in added]
            item['id'] = free_section_id(taken, 'B')
            if script_text:
                added.append({'after': item['after'], 'id': item['id'],
                              'title': item['title'], 'lines': item['lines'] or ['> (borrowed from %s)' % item['from']],
                              'text': '', 'pieces': item['pieces']})
            changes.append('borrowed %s "%s" from %s' % (item['what'], item['title'], item['from']))
        for side, seconds, title, subtitle in (('start', args.intro_card, args.intro_title, args.intro_subtitle), ('end', args.outro_card, args.outro_title, args.outro_subtitle)):
            if seconds:
                if not CARD_SECONDS[0] <= seconds <= CARD_SECONDS[1]:
                    raise el.Stop('A logo scene lasts %.0f to %.0f seconds.' % CARD_SECONDS, USAGE)
                card = Piece('card', seconds=seconds, title=title or '', subtitle=subtitle or '')
                pieces.insert(0, card) if side == 'start' else pieces.append(card)
                changes.append('%s with the Vardot logo' % ('opens' if side == 'start' else 'closes'))
        # a stretch with no length would make ffmpeg read to the end of its file (-t 0 means no limit there)
        pieces[:] = [p for p in pieces if p.kind == 'card' or p.end - p.start > 0.04]
        total = lay_out(pieces)
        music = {}
        for side, path, card, seconds in (('in', args.intro_music, args.intro_card, args.intro_seconds), ('out', args.outro_music, args.outro_card, args.outro_seconds)):
            if path:
                if not os.path.isfile(path):
                    raise el.Stop('The music file is missing: %s' % path, USAGE)
                music[side] = (path, card or seconds)
                changes.append('%s music' % ('intro' if side == 'in' else 'outro'))
        out = args.out
        if os.path.exists(out) and not args.force:
            raise el.Stop('%s already exists. Pass --force to replace it.' % out, USAGE)
        copy_only = not changes
        if copy_only:
            if not args.clone:
                raise el.Stop('Nothing to change: pick a change, or use --clone for a plain copy.', USAGE)
            changes.append('copied for re-work')
        if copy_only:
            tmp = os.path.join(os.path.dirname(os.path.abspath(out)), '.%s.part' % os.path.basename(out))
            shutil.copyfile(args.video, tmp)
            os.replace(tmp, out)
        else:
            cards = {}
            for i, piece in enumerate(pieces):
                if piece.kind == 'card':
                    picture = os.path.join(work, 'card%d.png' % i)
                    render_card(picture, piece.title, piece.subtitle, info['width'], info['height'])
                    cards[id(piece)] = picture
            inputs, graph, total = build_filters(pieces, info, music.get('in'), music.get('out'), args.music_volume, cards)
            part = os.path.join(os.path.dirname(os.path.abspath(out)), '.%s.part' % os.path.basename(out))
            el.run(['ffmpeg', '-y', '-loglevel', 'error'] + inputs + ['-filter_complex', graph, '-map', '[vout]', '-map', '[aout]',
                   '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k',
                   '-movflags', '+faststart', '-f', 'mp4', part])
            os.replace(part, out)
        poster = os.path.splitext(args.video)[0] + '-poster.jpg'
        new_poster = os.path.splitext(out)[0] + '-poster.jpg'
        if os.path.exists(poster) and (args.force or not os.path.exists(new_poster)):
            shutil.copyfile(poster, new_poster)
        script_out = None
        if script_text:
            script_out = args.script_out or os.path.splitext(out)[0] + '-voiceover-script.md'
            new_text = retime_script(script_text, pieces, added) if not copy_only else script_text
            if args.force or not os.path.exists(script_out):
                with open(script_out, 'w', encoding='utf-8') as handle:
                    handle.write(new_text)
        length = el.duration(out)
        record = {'kind': 'video-edit', 'borrowed': [{'from': b['from'], 'section': b['what'], 'title': b['title']} for b in borrowed], 'created_utc': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
                  'source': os.path.basename(args.video), 'changes': changes, 'seconds': round(length, 2) if length else None,
                  'script': os.path.basename(script_out) if script_out else None}
        with open(os.path.splitext(out)[0] + '-edit.json', 'w') as handle:
            json.dump(record, handle, indent=2)
        el.emit(args, dict(record, out=out), ['Wrote %s (%s)' % (out, el.mmss(length) if length else '?')] + ['  ' + c for c in changes] +
                (['Script: %s' % script_out] if script_out else []))
        return OK
    finally:
        shutil.rmtree(work, ignore_errors=True)


def build_parser():
    parser = argparse.ArgumentParser(prog='video_edit.py', description='Edit a video into a new version of itself.')
    sub = parser.add_subparsers(dest='command', required=True)
    info = sub.add_parser('info', help='size, frame rate and length of a video')
    info.add_argument('--video', type=el.text_arg, required=True)
    info.add_argument('--json', action='store_true')
    edit = sub.add_parser('edit', help='a new version with the changes asked for; with none, a plain copy')
    edit.add_argument('--video', type=el.text_arg, required=True)
    edit.add_argument('--out', type=el.text_arg, required=True)
    edit.add_argument('--script', type=el.text_arg, default='', help='the timed voiceover script; it is rewritten for the new version')
    edit.add_argument('--script-out', type=el.text_arg, default='')
    edit.add_argument('--strings-file', type=el.text_arg, default='', help='a JSON file holding the free text (titles, subtitles, add_text), so none of it is on a command line')
    edit.add_argument('--clone', action='store_true', help='a plain copy for re-work')
    edit.add_argument('--speed', type=float, default=None, help='%.2f to %.0f; 2 plays twice as fast' % (MIN_SPEED, MAX_SPEED))
    edit.add_argument('--length', type=el.text_arg, default='', help='make it this long: seconds or minutes:seconds')
    edit.add_argument('--trim', type=el.text_arg, default='', help='keep only start-end')
    edit.add_argument('--remove', type=el.text_arg, default='', help='section ids to cut out, comma separated')
    edit.add_argument('--add-title', type=el.text_arg, default='')
    edit.add_argument('--add-subtitle', type=el.text_arg, default='')
    edit.add_argument('--add-text', type=el.text_arg, default='', help='what the new section says')
    edit.add_argument('--add-after', type=el.text_arg, default='', help='a section id, start or end')
    edit.add_argument('--borrow', action='append', type=el.text_arg, default=[],
                      help='VIDEO|SECTION-or-START-END|AFTER|SCRIPT: a stretch of another video, put after a section, start or end (repeatable)')
    edit.add_argument('--engine', choices=('piper', 'elevenlabs'), default='')
    edit.add_argument('--voice', type=el.text_arg, default='')
    edit.add_argument('--model', type=el.text_arg, default=os.environ.get('ELEVENLABS_MODEL') or el.DEFAULT_MODEL)
    edit.add_argument('--intro-card', type=float, default=0, help='seconds of the Vardot logo before the video')
    edit.add_argument('--intro-title', type=el.text_arg, default='')
    edit.add_argument('--intro-subtitle', type=el.text_arg, default='')
    edit.add_argument('--outro-card', type=float, default=0, help='seconds of the Vardot logo after the video')
    edit.add_argument('--outro-title', type=el.text_arg, default='')
    edit.add_argument('--outro-subtitle', type=el.text_arg, default='')
    edit.add_argument('--intro-music', type=el.text_arg, default='')
    edit.add_argument('--intro-seconds', type=float, default=8.0, help='how long the intro music plays when there is no logo scene')
    edit.add_argument('--outro-music', type=el.text_arg, default='')
    edit.add_argument('--outro-seconds', type=float, default=8.0)
    edit.add_argument('--music-volume', type=float, default=0.5)
    edit.add_argument('--confirm', action='store_true', help='ElevenLabs only: actually send the new section\'s text')
    edit.add_argument('--force', action='store_true')
    edit.add_argument('--json', action='store_true')
    return parser


def main(argv):
    args = build_parser().parse_args(argv)
    try:
        return {'info': cmd_info, 'edit': cmd_edit}[args.command](args)
    except el.Stop as stop:
        print(stop, file=sys.stderr)
        return stop.code


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
