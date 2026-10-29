/**
 * Whether a screen session is working or waiting for a person.
 *
 * Its own module, with NO requires, because two processes need the same answer: the
 * dashboard (in its container) and the host screen runner (a standalone script that must
 * not pull the app's dependency tree in). One copy of the rules, so the badge on the page
 * and the flag on the host can never disagree.
 */

/**
 * Is this session WORKING, or WAITING FOR A PERSON?
 *
 * From the outside the two are identical — a detached session with a live process — so a
 * long agent run that has stopped to ask "which of these do you want?" sits there until
 * somebody thinks to look. That is the whole point of this: the Screens page can say it.
 *
 * The decision is made on the TAIL of the visible screen, because a question is drawn at
 * the bottom of a window, never at the top.
 *
 * The strongest signal is a NEGATIVE one, and it is checked first: Claude Code prints
 * `esc to interrupt` in its footer only while it is busy. Observed on a real run —
 *
 *   6 Thinking… (6m 16s · 23.9k tokens)
 *   ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt
 *
 * — so its presence means working, whatever else is on screen. Without it, the footer has
 * changed, and only then do the positive patterns get a say.
 *
 * Conservative on purpose. A badge that cries "waiting" on every row is worse than no
 * badge: it trains you to ignore it. Anything unrecognised is reported as neither.
 */
function waitingState(tail) {
  const text = String(tail || '');
  if (!text.trim()) return { waiting: false, why: '' };

  // Busy: the interrupt hint, or a spinner line with an elapsed timer.
  if (/esc to interrupt/i.test(text)) return { waiting: false, why: '' };
  if (/\b(Thinking|Working|Running|Compacting)…\s*\(/i.test(text)) return { waiting: false, why: '' };

  // A choice: a numbered list with a selection caret is what Claude Code draws for a
  // permission question or a plan decision. `❯` is its own marker; `>` is the fallback
  // some terminals get.
  if (/(^|\n)\s*[❯▶>]\s*\d+[.)]\s+\S/.test(text)) return { waiting: true, why: 'waiting on a choice' };
  if (/\b(1[.)]\s+Yes|Yes,\s+and\b|No,\s+and tell)/i.test(text)) return { waiting: true, why: 'waiting on a choice' };

  // A plain question — but only in the LAST FEW LINES, and only on a line that is
  // shaped like a prompt. An agent's own report says things like "the ticket asks: do
  // you want the picker? I implemented it", and matching that would put a pulsing
  // "waiting for you" badge on a session that is busy writing prose. A prompt is the
  // last thing on the screen and the line ENDS at the question; a mention is followed
  // by more sentence.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines.slice(-3);
  const asksHere = (re) => last.some((l) => re.test(l));
  // A question that has been ANSWERED is not a question. The two yes/no rules allow a few characters
  // after the bracket because a cursor sits there — and a typed `y` is one character, so
  //
  //   Do you want to continue? (y/n) y
  //   rajab@host:~/workspace/test/ruverify1$
  //
  // went on matching once the shell had moved on, and the hand never went down. A badge that cries
  // "waiting" on a session nobody is blocking is worse than no badge: it trains you to ignore it.
  // So those two ask the LAST line only — an answered prompt always has something after it, if only
  // the shell's own. The rules below keep the three-line window: a numbered choice list and a
  // "press Enter" are drawn with a footer under them.
  const asksLast = (re) => re.test(lines[lines.length - 1] || '');

  if (asksLast(/\((y\/n|y\/N|Y\/n|yes\/no)\)\s*\S{0,3}$/i)) return { waiting: true, why: 'waiting on yes/no' };
  if (asksLast(/\[(y\/N|Y\/n)\]\s*\S{0,3}$/)) return { waiting: true, why: 'waiting on yes/no' };
  if (asksHere(/^(Do you want|Would you like)\b[^?]{0,80}\?$/i)) return { waiting: true, why: 'waiting on an answer' };
  if (asksHere(/^(Proceed|Continue|Overwrite|Are you sure)\b[^?]{0,40}\?$/i)) return { waiting: true, why: 'waiting on an answer' };
  if (asksHere(/Press (Enter|any key) to (continue|proceed)/i)) return { waiting: true, why: 'waiting for Enter' };
  if (asksHere(/^(Enter (a |the )?(value|name|password|token)|Please enter)\b/i)) return { waiting: true, why: 'waiting for input' };

  // Claude Code sitting at its own prompt with nothing running: its footer hints are
  // there, the interrupt hint is not. That is a finished agent waiting to be told what
  // is next — worth flagging, more gently than an unanswered question.
  if (/(\? for shortcuts|bypass permissions on|shift\+tab to cycle)/i.test(text)) {
    return { waiting: true, why: 'idle at its prompt' };
  }

  return { waiting: false, why: '' };
}

module.exports = { waitingState };
