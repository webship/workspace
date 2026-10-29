// Moves of particular avatars, by set: an avatar whose set is named here does these instead of the
// shared ones in assistant-avatar.js where the names meet, and has the rest as well.
//
// labiba: Labiba's own moves, from her avatar app (github.com/Natshah/labiba-meme-avatar, public/avatar.js),
// chosen for work: greetings, agreeing and disagreeing, a bow, thinking, explaining, drawing on the board,
// presenting, reading, a magnifier, a globe, a launch. Her arms are locks of hair that start beside her
// cheeks, so these angles are hers; the props she holds in her own app (chalk, a book) are not drawn here.
// Left out on purpose: the headscarf, and the moves meant for children (kisses, hugs, a dab, peekaboo…).
//
// clock: the Vardot Bot's, a clock-faced character with a steady bearing: its body is its head, so it tilts, leans and bounces as one, and its hands race round the dial when it is pleased (`o.clockSpin`, in
// turns, which the page adds to the hands).
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const envelope = (t, inn = 0.2, out = 0.2) => (t < inn ? ease(t / inn) : t > 1 - out ? ease((1 - t) / out) : 1);

export const MOVE_SETS = {
  clock: {
    // From the arms-down rest: a left arm rises with +z and a right arm with -z; a forearm bends on the same
    // axis, and turns about x (the line of the arm in the T-pose). The arms are rubber hose, so a bend is a curve.
    stand: {
      duration: 3,
      pose(t, p) {
        // Fists on hips, elbows out: ready, confident.
        const e = envelope(t, 0.2, 0.2);
        p.add('leftUpperArm', 0, 0.2 * e, 0.6 * e);
        p.add('rightUpperArm', 0, -0.2 * e, -0.6 * e);
        p.add('leftLowerArm', 0, -0.4 * e, -1.5 * e);
        p.add('rightLowerArm', 0, 0.4 * e, 1.5 * e);
        p.hand('left', 'fist', e); p.hand('right', 'fist', e);
        p.add('head', Math.max(0, Math.sin(t * Math.PI * 2)) * 0.1 * e, 0, 0);
      },
    },
    welcome: {
      duration: 2.6,
      pose(t, p, o) {
        // Both arms out and low, palms up and open, leaning back a little: here it is.
        const e = envelope(t, 0.2, 0.25);
        p.add('leftUpperArm', 0, 0, 0.75 * e);
        p.add('rightUpperArm', 0, 0, -0.75 * e);
        p.add('leftLowerArm', -1.3 * e, 0, 0.35 * e);
        p.add('rightLowerArm', -1.3 * e, 0, -0.35 * e);
        p.hand('left', 'open', e); p.hand('right', 'open', e);
        p.add('spine', -0.08 * e, 0, 0);
        o.hipsY += Math.sin(t * Math.PI) * 0.015;
      },
      face: (t) => ({ happy: envelope(t) * 0.8 }),
    },
    showcase: {
      duration: 2.8,
      pose(t, p) {
        // One arm swept out to the side, palm up, the body leaning that way and looking there; the other fist on the hip.
        const e = envelope(t, 0.2, 0.25);
        p.add('rightUpperArm', 0, -0.3 * e, -1.25 * e);
        p.add('rightLowerArm', -1.2 * e, 0, -0.2 * e);
        p.hand('right', 'open', e);
        p.add('leftUpperArm', 0, 0.2 * e, 0.6 * e);
        p.add('leftLowerArm', 0, -0.4 * e, -1.5 * e);
        p.hand('left', 'fist', e);
        p.add('spine', 0, 0, -0.1 * e);
        p.add('head', 0, -0.3 * e, -0.08 * e);
      },
      face: (t) => ({ happy: envelope(t) * 0.6, lookRight: envelope(t) * 0.6 }),
    },
    fistpump: {
      duration: 1.8,
      pose(t, p, o) {
        // A fist up, pumped twice: yes!
        const e = envelope(t, 0.12, 0.25);
        const pump = Math.max(0, Math.sin(t * Math.PI * 4));
        p.add('rightUpperArm', 0, 0, -2.95 * e);
        p.add('rightLowerArm', 0, 0, -0.1 * e - 0.4 * pump * e);
        p.hand('right', 'fist', e);
        p.add('head', -0.05 * e, 0, 0.06 * e);
        o.hipsY += pump * 0.02 * e;
      },
      face: (t) => ({ happy: envelope(t) }),
    },
    me: {
      duration: 2.2,
      pose(t, p) {
        // A thumb turned to itself: that is me, I can do it.
        const e = envelope(t, 0.2, 0.25);
        p.add('rightUpperArm', 0, 0.9 * e, -0.15 * e);
        p.add('rightLowerArm', 0, 1.6 * e, 0.3 * e);
        p.hand('right', 'thumbsup', e);
        p.add('head', 0.06 * e, 0, 0);
      },
      face: (t) => ({ happy: envelope(t) * 0.7 }),
    },
    sideeye: {
      duration: 2.4,
      pose(t, p) {
        // A sidelong look with a tilt: hmm, really?
        const e = envelope(t, 0.2, 0.3);
        p.add('head', 0.04 * e, 0.12 * e, 0.16 * e);
        p.add('leftUpperArm', 0, 0.2 * e, 0.6 * e);
        p.add('leftLowerArm', 0, -0.4 * e, -1.5 * e);
        p.hand('left', 'fist', e);
      },
      face: (t) => ({ lookRight: envelope(t, 0.15, 0.3), relaxed: 0.5 * envelope(t) }),
    },
    wink: {
      duration: 1.6,
      pose(t, p) {
        // A wink and a thumbs up: got it, leave it with me.
        const e = envelope(t, 0.15, 0.3);
        p.add('rightUpperArm', 0, 0, -0.9 * e);
        p.add('rightLowerArm', 0, 0, -1.2 * e);
        p.hand('right', 'thumbsup', e);
        p.add('head', 0, 0, -0.1 * e);
      },
      face: (t) => ({ blinkLeft: envelope(t, 0.25, 0.35), happy: 0.6 * envelope(t) }),
    },
    strut: {
      duration: 2.4,
      pose(t, p, o) {
        // A cartoon strut on the spot: a bounce on every step, the legs swinging across, the arms swinging.
        const e = envelope(t, 0.12, 0.15);
        const step = Math.sin(t * Math.PI * 6);
        p.add('leftUpperLeg', -0.45 * step * e, 0, 0.15 * step * e);
        p.add('rightUpperLeg', 0.45 * step * e, 0, 0.15 * step * e);
        p.add('leftLowerLeg', 0.5 * Math.max(0, step) * e, 0, 0);
        p.add('rightLowerLeg', 0.5 * Math.max(0, -step) * e, 0, 0);
        p.add('leftUpperArm', 0.5 * step * e, 0, 0.25 * e);
        p.add('rightUpperArm', -0.5 * step * e, 0, -0.25 * e);
        p.add('head', 0, 0, 0.06 * step * e);
        o.hipsY += Math.abs(step) * 0.025 * e;
      },
      face: (t) => ({ happy: 0.7 * envelope(t) }),
    },
    tilt: {
      duration: 2.2,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.25);
        p.add('head', 0.05 * e, 0.1 * e, 0.3 * e);
        p.add('leftUpperArm', 0, 0, 0.5 * e);
        p.add('rightUpperArm', 0, 0, -0.2 * e);
      },
    },
    lean: {
      duration: 2.4,
      pose(t, p, o) {
        const e = envelope(t, 0.2, 0.25);
        p.add('spine', 0.18 * e, 0, 0);
        p.add('head', 0.12 * e, 0, 0);
        p.add('leftUpperArm', 0.3 * e, 0, 0.3 * e);
        p.add('rightUpperArm', 0.3 * e, 0, -0.3 * e);
        o.hipsZ += 0.04 * e;
      },
    },
    bounce: {
      duration: 1.6,
      pose(t, p, o) {
        const e = envelope(t, 0.1, 0.2);
        const hop = Math.abs(Math.sin(t * Math.PI * 3));
        o.hipsY += hop * 0.06 * e;
        p.add('leftUpperLeg', -0.3 * hop * e, 0, 0);
        p.add('rightUpperLeg', -0.3 * hop * e, 0, 0);
        p.add('leftLowerLeg', 0.5 * hop * e, 0, 0);
        p.add('rightLowerLeg', 0.5 * hop * e, 0, 0);
        p.add('leftUpperArm', 0, 0, 0.6 * hop * e);
        p.add('rightUpperArm', 0, 0, -0.6 * hop * e);
      },
    },
    spinhands: {
      duration: 2,
      pose(t, p, o) {
        const e = envelope(t, 0.2, 0.3);
        o.clockSpin += ease(t) * 4;
        p.add('head', 0, 0, Math.sin(t * Math.PI * 4) * 0.08 * e);
        p.add('leftUpperArm', 0, 0, 1.2 * e);
        p.add('rightUpperArm', 0, 0, -1.2 * e);
        p.add('leftLowerArm', 0, 0, 0.6 * e);
        p.add('rightLowerArm', 0, 0, -0.6 * e);
      },
    },
    tada: {
      duration: 2.2,
      pose(t, p, o) {
        const e = envelope(t, 0.15, 0.25);
        o.clockSpin += ease(t) * 2;
        p.add('leftUpperArm', 0, 0, 2.4 * e);
        p.add('rightUpperArm', 0, 0, -2.4 * e);
        p.add('leftLowerArm', 0, 0, 0.3 * e);
        p.add('rightLowerArm', 0, 0, -0.3 * e);
        p.hand('left', 'open', e); p.hand('right', 'open', e);
        p.add('head', -0.08 * e, 0, Math.sin(t * Math.PI * 2) * 0.12 * e);
        o.hipsY += Math.abs(Math.sin(t * Math.PI * 2)) * 0.03 * e;
      },
    },
    tick: {
      duration: 2,
      pose(t, p) {
        const e = envelope(t, 0.1, 0.2);
        const step = Math.floor(t * 8) % 2 ? 1 : -1;
        p.add('head', 0, 0, step * 0.12 * e);
        p.add('leftUpperArm', 0, 0, 0.2 * e);
        p.add('rightUpperArm', 0, 0, -0.2 * e);
      },
    },
    glance: {
      duration: 2.2,
      pose(t, p) {
        const e = envelope(t, 0.25, 0.3);
        p.add('head', 0, 0.55 * e, 0.04 * e);
        p.add('spine', 0, 0.15 * e, 0);
      },
    },
    alert: {
      duration: 1.8,
      pose(t, p, o) {
        // One arm straight up, a finger raised: attention, something matters.
        const e = envelope(t, 0.12, 0.25);
        p.add('rightUpperArm', 0, 0, -2.9 * e);
        p.add('rightLowerArm', 0, 0, -0.15 * e);
        p.hand('right', 'point', e);
        p.add('head', -0.1 * e, 0, 0);
        o.hipsY += 0.02 * e;
      },
    },
  },
  labiba: {
    wave: {
      duration: 2.4,
      pose(t, p) {
        const e = envelope(t, 0.18, 0.2);
        p.add('rightUpperArm', 0, -0.25 * e, -1.4 * e);
        p.add('rightLowerArm', 0, 0.3 * e, -1.2 * e + Math.sin(t * Math.PI * 10) * 0.35 * e);
        p.add('rightHand', 0, 0, Math.sin(t * Math.PI * 10 + 0.6) * 0.2 * e);
        p.add('head', 0, -0.12 * e, 0.08 * e);
        p.add('spine', 0, 0, 0.05 * e);
      },
    },
    nod: {
      duration: 1.4,
      pose(t, p) {
        const e = envelope(t, 0.1, 0.25);
        p.add('head', Math.max(0, Math.sin(t * Math.PI * 4)) * 0.28 * e, 0, 0);
        p.add('neck', Math.max(0, Math.sin(t * Math.PI * 4)) * 0.1 * e, 0, 0);
      },
    },
    shake: {
      duration: 1.5,
      pose(t, p) {
        const e = envelope(t, 0.12, 0.25);
        p.add('head', 0.05 * e, Math.sin(t * Math.PI * 6) * 0.35 * e, 0);
      },
    },
    bow: {
      duration: 2.2,
      pose(t, p) {
        const e = envelope(t, 0.3, 0.35);
        p.add('spine', 0.35 * e, 0, 0);
        p.add('chest', 0.2 * e, 0, 0);
        p.add('head', 0.2 * e, 0, 0);
        p.add('leftUpperArm', 0, -0.25 * e, 0.1 * e);
        p.add('rightUpperArm', 0, 0.25 * e, -0.1 * e);
      },
    },
    think: {
      duration: 3,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.2);
        p.add('rightUpperArm', 0, 0.9 * e, -0.25 * e);
        p.add('rightLowerArm', 0, 1.9 * e, -0.2 * e);
        p.add('rightHand', 0, 0, -0.3 * e);
        p.add('head', -0.15 * e, -0.15 * e, 0.12 * e + Math.sin(t * Math.PI * 3) * 0.03 * e);
        p.add('spine', 0, 0, -0.04 * e);
      },
    },
    shrug: {
      duration: 1.8,
      pose(t, p) {
        const e = envelope(t, 0.25, 0.3);
        p.add('leftShoulder', 0, 0, 0.3 * e);
        p.add('rightShoulder', 0, 0, -0.3 * e);
        p.add('leftUpperArm', 0, -0.2 * e, 0.45 * e);
        p.add('rightUpperArm', 0, 0.2 * e, -0.45 * e);
        p.add('leftLowerArm', 0, -1.3 * e, 0.2 * e);
        p.add('rightLowerArm', 0, 1.3 * e, -0.2 * e);
        p.add('leftHand', -0.6 * e, 0, 0);
        p.add('rightHand', -0.6 * e, 0, 0);
        p.add('head', 0, 0, 0.18 * e);
      },
    },
    cheer: {
      duration: 2.2,
      pose(t, p, o) {
        const e = envelope(t, 0.15, 0.2);
        const pump = Math.sin(t * Math.PI * 8) * 0.15 * e;
        p.add('leftUpperArm', 0, 0, 2.3 * e + pump);
        p.add('rightUpperArm', 0, 0, -2.3 * e - pump);
        p.add('leftLowerArm', 0, 0, 0.3 * e);
        p.add('rightLowerArm', 0, 0, -0.3 * e);
        p.add('head', -0.15 * e, 0, 0);
        o.hipsY += Math.abs(Math.sin(t * Math.PI * 4)) * 0.06 * e;
      },
    },
    point: {
      duration: 2,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.25);
        p.add('rightUpperArm', 0, 1.1 * e, -1.0 * e);
        p.add('rightLowerArm', 0, -0.2 * e, 0);
        p.add('head', 0, -0.1 * e, 0);
      },
    },
    // ---- Drawing on the board: the arm goes up to the board and the forearm works like a hand drawing ----------
    // draw: small quick strokes (a line, a letter, a small shape).
    draw: {
      duration: 1.3,
      pose(t, p) {
        const e = envelope(t, 0.14, 0.2);
        const s = Math.sin(t * Math.PI * 7);
        p.add('rightUpperArm', 0, 0.85 * e, -1.15 * e);
        p.add('rightLowerArm', 0, (-0.3 + 0.3 * s) * e, 0.12 * Math.cos(t * Math.PI * 7) * e);
        p.add('rightHand', 0.35 * s * e, 0, 0);
        p.add('head', 0.04 * e, -0.2 * e + 0.05 * s * e, 0.05 * e);
        p.add('spine', 0.05 * e, -0.08 * e, 0);
      },
      face: (t) => ({ happy: 0.25 * envelope(t) }),
    },
    // drawbig: a wide sweep of the whole arm (a backdrop, a big shape, a picture going on).
    drawbig: {
      duration: 1.8,
      pose(t, p) {
        const e = envelope(t, 0.12, 0.2);
        const sw = Math.sin(t * Math.PI * 3);
        p.add('rightUpperArm', 0, (0.45 + 0.45 * sw) * e, -1.25 * e);
        p.add('rightLowerArm', 0, (-0.15 + 0.2 * sw) * e, 0);
        p.add('leftUpperArm', 0, -0.2 * e, 0.35 * e);
        p.add('head', 0.03 * e, (-0.15 - 0.15 * sw) * e, 0.04 * e);
        p.add('spine', 0.08 * e, -0.16 * sw * e, 0);
      },
      face: (t) => ({ happy: 0.3 * envelope(t) }),
    },
    // dab: quick taps (a dot, a star, a tick).
    holdup: {
      duration: 2.6,
      pose(t, p, o) {
        const e = envelope(t, 0.2, 0.25);
        p.add('leftUpperArm', 0, -0.6 * e, 1.6 * e);
        p.add('rightUpperArm', 0, 0.6 * e, -1.6 * e);
        p.add('leftLowerArm', 0, -0.5 * e, 0);
        p.add('rightLowerArm', 0, 0.5 * e, 0);
        p.add('head', -0.15 * e, 0, 0);
        o.hipsY += 0.03 * Math.sin(t * Math.PI * 2) * e;
      },
      face: (t) => ({ happy: 0.8 * envelope(t) }),
    },
    // Turning golden and shining, with stars round her (episode 27).
    swipedown: {
      duration: 1.3,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.25);
        const drag = t < 0.3 ? 0 : t > 0.8 ? 1 : (t - 0.3) / 0.5;
        p.add('rightUpperArm', 0, 1.0 * e, (-0.5 - 0.7 * ease(drag)) * e);
        p.add('rightLowerArm', 0, 0.6 * e, 0);
        p.add('head', -0.08 * e, -0.15 * e, 0);
      },
    },
    // Scrolling up: the same hand starts high and draws downward.
    swipeup: {
      duration: 1.3,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.25);
        const drag = t < 0.3 ? 0 : t > 0.8 ? 1 : (t - 0.3) / 0.5;
        p.add('rightUpperArm', 0, 1.0 * e, (-1.2 + 0.7 * ease(drag)) * e);
        p.add('rightLowerArm', 0, 0.6 * e, 0);
        p.add('head', 0.06 * e, -0.15 * e, 0);
      },
    },
    // A tap: one finger forward, a quick press, back.
    tap: {
      duration: 0.9,
      pose(t, p) {
        const e = envelope(t, 0.25, 0.3);
        const press = Math.sin(Math.min(1, Math.max(0, (t - 0.3) / 0.35)) * Math.PI);
        p.add('rightUpperArm', 0, (1.1 + 0.25 * press) * e, -0.9 * e);
        p.add('rightLowerArm', 0, (0.3 - 0.25 * press) * e, 0);
        p.add('head', 0.05 * press, 0, 0);
      },
    },
    // Making something bigger: both hands together in front, then spread wide, as on a touch screen.
    push: {
      duration: 1.4,
      pose(t, p, o) {
        const wind = t < 0.35 ? envelope(t / 0.35, 0.6, 0) : 0;
        const shove = t >= 0.3 ? envelope((t - 0.3) / 0.7, 0.15, 0.55) : 0;
        p.add('leftUpperArm', 0, -1.25 * shove - 0.5 * wind, 0.35 * shove + 0.2 * wind);
        p.add('rightUpperArm', 0, 1.25 * shove + 0.5 * wind, -0.35 * shove - 0.2 * wind);
        p.add('leftLowerArm', 0, -1.1 * wind, 0);
        p.add('rightLowerArm', 0, 1.1 * wind, 0);
        p.add('spine', -0.12 * wind + 0.2 * shove, 0, 0);
        p.add('head', 0.08 * shove, 0, 0);
        o.hipsZ += 0.12 * shove - 0.05 * wind;
      },
      face: (t) => ({ happy: 0.5, surprised: t > 0.35 && t < 0.6 ? 0.4 : 0 }),
    },
    clap: {
      duration: 2,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.2);
        const c = (Math.sin(t * Math.PI * 12) * 0.5 + 0.5) * e;
        p.add('leftUpperArm', 0, -0.9 * e - 0.15 * c, 0.55 * e);
        p.add('rightUpperArm', 0, 0.9 * e + 0.15 * c, -0.55 * e);
        p.add('leftLowerArm', 0, -0.9 * e, 0);
        p.add('rightLowerArm', 0, 0.9 * e, 0);
      },
      face: () => ({ happy: 0.8 }),
    },
    surprised: {
      duration: 1.6,
      pose(t, p, o) {
        const e = envelope(t, 0.08, 0.35);
        p.add('leftUpperArm', 0, -0.5 * e, 1.5 * e);
        p.add('rightUpperArm', 0, 0.5 * e, -1.5 * e);
        p.add('leftLowerArm', 0, -1.4 * e, 0);
        p.add('rightLowerArm', 0, 1.4 * e, 0);
        p.add('spine', -0.12 * e, 0, 0);
        p.add('head', -0.12 * e, 0, 0);
        o.hipsZ -= 0.06 * e;
        o.hipsY += 0.05 * e * Math.min(1, t / 0.12);
      },
      face: (t) => ({ surprised: envelope(t, 0.06, 0.35) }),
    },
    idea: {
      duration: 2.2,
      pose(t, p, o) {
        const e = envelope(t, 0.15, 0.25);
        p.add('rightUpperArm', 0, 0.1 * e, -2.6 * e);
        p.add('rightLowerArm', 0, 0, -0.3 * e);
        p.add('head', -0.2 * e, 0, 0.08 * e);
        o.hipsY += 0.03 * e;
      },
      face: (t) => ({ happy: 0.8 * envelope(t), surprised: 0.25 * envelope(t) }),
    },
    confused: {
      duration: 2.6,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.25);
        p.add('head', 0, -0.1 * e, 0.28 * e);
        p.add('rightUpperArm', 0, 0.6 * e, -1.9 * e);
        p.add('rightLowerArm', 0, 2.0 * e, 0);
        p.add('rightHand', Math.sin(t * 30) * 0.3 * e, 0, 0);
      },
      face: (t) => ({ relaxed: 0.3 * envelope(t), sad: 0.2 * envelope(t) }),
    },
    laugh: {
      duration: 2.2,
      pose(t, p, o) {
        const e = envelope(t, 0.1, 0.2);
        const bounce = Math.abs(Math.sin(t * Math.PI * 9));
        p.add('head', (-0.22 + 0.06 * bounce) * e, 0, 0);
        p.add('chest', -0.08 * e, 0, 0);
        p.add('leftShoulder', 0, 0, 0.12 * bounce * e);
        p.add('rightShoulder', 0, 0, -0.12 * bounce * e);
        p.add('leftUpperArm', 0, -0.55 * e, 0.2 * e);
        p.add('rightUpperArm', 0, 0.55 * e, -0.2 * e);
        p.add('leftLowerArm', 0, -1.3 * e, 0);
        p.add('rightLowerArm', 0, 1.3 * e, 0);
        o.hipsY += 0.02 * bounce * e;
        o.mouth = Math.max(o.mouth || 0, (0.55 + 0.4 * bounce) * e);
      },
      face: (t) => ({ happy: envelope(t, 0.08, 0.2) }),
    },
    fly: {
      duration: 4.5,
      pose(t, p, o) {
        const e = envelope(t, 0.12, 0.18);
        const a = t * Math.PI * 2;
        o.hipsX += Math.sin(a) * 0.55 * e;
        o.hipsZ += Math.sin(2 * a) * 0.25 * e;
        o.hipsY += (0.12 + 0.06 * Math.sin(3 * a)) * e;
        p.add('hips', 0.25 * e, Math.cos(a) * 0.9 * e, -Math.cos(a) * 0.35 * e);
        p.add('leftUpperArm', 0, 0, (0.9 + Math.sin(a * 4) * 0.15) * e);
        p.add('rightUpperArm', 0, 0, -(0.9 + Math.sin(a * 4) * 0.15) * e);
        p.add('leftUpperLeg', 0.4 * e, 0, 0);
        p.add('rightUpperLeg', 0.4 * e, 0, 0);
      },
      face: (t) => ({ happy: 0.6 * envelope(t) }),
    },
    explain: {
      duration: 4,
      pose(t, p) {
        const e = envelope(t, 0.12, 0.2);
        const a = t * Math.PI * 2 * 2;
        p.add('leftUpperArm', 0, -0.5 * e, 0.35 * e);
        p.add('rightUpperArm', 0, 0.5 * e, -0.35 * e);
        p.add('leftLowerArm', 0, -(1.0 + 0.35 * Math.sin(a)) * e, 0);
        p.add('rightLowerArm', 0, (1.0 + 0.35 * Math.sin(a + Math.PI)) * e, 0);
        p.add('head', 0.06 * Math.sin(a * 1.5) * e, 0, 0);
        p.add('chest', 0, 0.1 * Math.sin(a / 2) * e, 0);
      },
      face: (t) => ({ happy: 0.4 * envelope(t) }),
    },
    look: {
      duration: 3,
      pose(t, p) {
        const e = envelope(t, 0.1, 0.2);
        const yaw = Math.sin(t * Math.PI * 2) * 0.75 * e;
        p.add('head', 0, yaw, 0);
        p.add('neck', 0, 0.3 * yaw, 0);
        p.add('chest', 0, 0.15 * yaw, 0);
        p.add('rightUpperArm', 0, 0.7 * e, -1.6 * e);
        p.add('rightLowerArm', 0, 1.9 * e, 0);
      },
      face: (t) => ({ surprised: 0.2 * envelope(t) }),
    },
    bye: {
      duration: 2.6,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.2);
        const w = Math.sin(t * Math.PI * 10) * 0.35 * e;
        p.add('leftUpperArm', 0, 0.25 * e, 1.4 * e);
        p.add('rightUpperArm', 0, -0.25 * e, -1.4 * e);
        p.add('leftLowerArm', 0, -0.3 * e, 1.0 * e + w);
        p.add('rightLowerArm', 0, 0.3 * e, -1.0 * e - w);
        p.add('head', 0.1 * e, 0, 0.12 * Math.sin(t * Math.PI * 2) * e);
      },
      face: (t) => ({ happy: envelope(t) }),
    },
    proud: {
      duration: 2.4,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.25);
        p.add('leftUpperArm', 0, 0.3 * e, 0.6 * e);
        p.add('rightUpperArm', 0, -0.3 * e, -0.6 * e);
        p.add('leftLowerArm', 0, 1.6 * e, 0);
        p.add('rightLowerArm', 0, -1.6 * e, 0);
        p.add('head', -0.25 * e, 0, 0);
        p.add('chest', -0.15 * e, 0, 0);
      },
      face: (t) => ({ happy: 0.7 * envelope(t), relaxed: 0.5 * envelope(t) }),
    },
    listen: {
      // A hand cupped behind an ear, head tilted to it.
      duration: 3,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.2);
        p.add('rightUpperArm', 0, 0.3 * e, -1.3 * e);
        p.add('rightLowerArm', 0, 0, -1.6 * e);
        p.add('head', 0, -0.2 * e, -0.25 * e);
      },
      face: (t) => ({ surprised: 0.2 * envelope(t) }),
    },
    read: {
      duration: 5,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.15);
        p.add('leftUpperArm', 0, -0.8 * e, 0.5 * e);
        p.add('rightUpperArm', 0, 0.8 * e, -0.5 * e);
        p.add('leftLowerArm', 0, -1.3 * e, 0);
        p.add('rightLowerArm', 0, 1.3 * e, 0);
        p.add('head', 0.25 * e, 0.12 * Math.sin(t * Math.PI * 4) * e, 0);
      },
      face: (t) => ({ relaxed: 0.4 * envelope(t), happy: 0.4 }),
    },
    magnify: {
      duration: 4,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.2);
        p.add('rightUpperArm', 0, 0.6 * e, -1.4 * e);
        p.add('rightLowerArm', 0, 1.2 * e, 0);
        p.add('head', 0.1 * e, 0.35 * Math.sin(t * Math.PI * 2) * e, 0);
        p.add('spine', 0.1 * e, 0, 0);
      },
      face: (t) => ({ surprised: 0.3 * envelope(t) }),
    },
    globe: {
      duration: 4,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.2);
        p.add('leftUpperArm', 0, -0.9 * e, 0.8 * e);
        p.add('rightUpperArm', 0, 0.9 * e, -0.8 * e);
        p.add('leftLowerArm', 0, -1.2 * e, 0);
        p.add('rightLowerArm', 0, 1.2 * e, 0);
        p.add('head', 0.15 * e, 0, 0.1 * Math.sin(t * Math.PI * 2) * e);
      },
      face: (t) => ({ happy: 0.7 * envelope(t) }),
    },
    rocket: {
      duration: 3,
      pose(t, p, o) {
        const throwUp = ease(Math.min(1, t / 0.45));
        const e = envelope(t, 0.1, 0.25);
        p.add('rightUpperArm', 0, 0.3 * e, -2.4 * throwUp * e);
        p.add('head', -0.35 * throwUp * e, 0, 0);
        o.hipsY += 0.04 * Math.sin(Math.min(1, t / 0.45) * Math.PI);
      },
      face: (t) => ({ happy: 0.8 * envelope(t), surprised: 0.4 * envelope(t) }),
    },
    raiseright: {
      duration: 2,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.25);
        p.add('rightUpperArm', 0, 0.1 * e, -2.7 * e);
        p.add('head', -0.06 * e, 0, -0.05 * e);
      },
      face: (t) => ({ happy: 0.5 * envelope(t) }),
    },
    raiseleft: {
      duration: 2,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.25);
        p.add('leftUpperArm', 0, -0.1 * e, 2.7 * e);
        p.add('head', -0.06 * e, 0, 0.05 * e);
      },
      face: (t) => ({ happy: 0.5 * envelope(t) }),
    },
    thumbsup: {
      duration: 1.8,
      pose(t, p) {
        const e = envelope(t, 0.15, 0.25);
        p.add('rightUpperArm', 0, 0.9 * e, -0.6 * e);
        p.add('rightLowerArm', 0, 0, -1.2 * e);
        p.add('head', 0, 0, 0.1 * e);
      },
      face: (t) => ({ happy: 0.8 * envelope(t), blinkLeft: t > 0.4 && t < 0.6 ? 1 : 0 }),
    },
    hips: {
      duration: 2.4,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.25);
        p.add('leftUpperArm', 0, 0.3 * e, 0.6 * e);
        p.add('rightUpperArm', 0, -0.3 * e, -0.6 * e);
        p.add('leftLowerArm', 0, 1.6 * e, 0);
        p.add('rightLowerArm', 0, -1.6 * e, 0);
        p.add('head', -0.05 * e, 0, 0.08 * e);
      },
      face: (t) => ({ happy: 0.4 * envelope(t) }),
    },
    crossarms: {
      duration: 3,
      pose(t, p) {
        const e = envelope(t, 0.2, 0.2);
        p.add('leftUpperArm', 0, -1.0 * e, 0.45 * e);
        p.add('rightUpperArm', 0, 1.0 * e, -0.35 * e);
        p.add('leftLowerArm', 0, -2.1 * e, 0);
        p.add('rightLowerArm', 0, 2.0 * e, 0);
        p.add('spine', -0.06 * e, 0, 0);
        p.add('head', 0, 0.12 * e, 0.06 * e);
      },
      face: (t) => ({ relaxed: 0.3 * envelope(t), happy: 0.1 }),
    },
  },
};
