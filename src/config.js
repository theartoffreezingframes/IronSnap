/**
 * Central tuning table for the WONDER/SNAP interface.
 * Everything that a human might want to tweak lives here.
 */

export const GESTURES = {
  OPEN_PALM: { label: 'OPEN PALM', action: 'EXPAND UNIVERSE', key: 'Q', discrete: false },
  FIST: { label: 'CLOSED FIST', action: 'COMPRESS TO SPHERE', key: 'E', discrete: false },
  PINCH: { label: 'PINCH', action: 'GRAB HOLOGRAM', key: 'SPACE', discrete: true },
  PEACE: { label: 'TWO FINGER', action: 'ENERGY ARC', key: 'V', discrete: true },
  VICTORY: { label: 'VICTORY', action: 'OVERDRIVE MODE', key: 'X', discrete: true },
  THUMB_UP: { label: 'THUMB UP', action: 'CONFIRM', key: 'Y', discrete: true },
  SWIPE_LEFT: { label: 'SWIPE LEFT', action: 'PREVIOUS MODE', key: '[', discrete: true },
  SWIPE_RIGHT: { label: 'SWIPE RIGHT', action: 'NEXT MODE', key: ']', discrete: true },
  TWO_HANDS: { label: 'DUAL HAND', action: 'LINK / SCALE', key: '', discrete: false },
  SPREAD: { label: 'HANDS APART', action: 'EXPAND UNIVERSE', key: '', discrete: true },
  CLOSE: { label: 'HANDS TOGETHER', action: 'COLLAPSE UNIVERSE', key: '', discrete: true },
  NONE: { label: 'TRACKING', action: 'STANDBY', key: '', discrete: false },
};

export const GESTURE_COOLDOWNS = {
  PINCH: 260,
  PEACE: 900,
  VICTORY: 1400,
  THUMB_UP: 1600,
  SWIPE_LEFT: 650,
  SWIPE_RIGHT: 650,
  SPREAD: 900,
  CLOSE: 900,
};

/** Frames a gesture must persist before it is accepted (≈ 30 fps → 130 ms). */
export const STABILITY_FRAMES = 4;
/** Minimum mean score for a candidate gesture to be accepted. */
export const MIN_CONFIDENCE = 0.55;

export const FIELD = {
  /** Continuous expansion driven by the open palm / two-hand spread. */
  expandMin: 0.72,
  expandMax: 1.9,
  /** Compression driven by the fist. */
  compressMax: 0.86,
  /** How strongly the hand position steers the whole field (world units). */
  steerX: 4.6,
  steerY: 3.0,
  smoothing: 4.2,
};

export const SWIPE = {
  /** Minimum horizontal travel in normalised screen units. */
  distance: 0.11,
  /** Maximum time window for the travel (ms). */
  window: 320,
  /** Minimum average speed in normalised screen widths per second. */
  speed: 0.85,
  cooldown: 650,
};

export const TRACKING = {
  numHands: 2,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  /** One-Euro filter parameters. Lower minCutoff = smoother, higher beta = less lag. */
  filter: { minCutoff: 1.4, beta: 0.02, dCutoff: 1.0 },
  /** Video constraints requested from getUserMedia. */
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 60 },
  },
};

export const MODES = [
  {
    id: 'NEBULA',
    name: 'NEBULA',
    subtitle: 'IONISED DUST CLOUD',
    colorA: '#22d3ee',
    colorB: '#3b82f6',
    colorC: '#a855f7',
    accent: 0x22d3ee,
    energy: 1,
  },
  {
    id: 'QUASAR',
    name: 'QUASAR',
    subtitle: 'VIOLET PLASMA JET',
    colorA: '#a855f7',
    colorB: '#6366f1',
    colorC: '#f472b6',
    accent: 0xa855f7,
    energy: 1.35,
  },
  {
    id: 'ION',
    name: 'ION',
    subtitle: 'ELECTRIC TELEMETRY GRID',
    colorA: '#22d3ee',
    colorB: '#0ea5e9',
    colorC: '#22ffd6',
    accent: 0x2ee6ff,
    energy: 1.7,
  },
  {
    id: 'VOID',
    name: 'VOID',
    subtitle: 'MINIMAL SINGULARITY',
    colorA: '#94a3b8',
    colorB: '#334155',
    colorC: '#e0f2fe',
    accent: 0xb6c6dd,
    energy: 0.65,
  },
];

export const PALETTE = {
  sky: '#050914',
  deep: '#02040a',
  cyan: '#22d3ee',
  blue: '#3b82f6',
  purple: '#a855f7',
  good: '#22ffb2',
  warn: '#ffb84d',
  bad: '#ff5d7a',
};

export const KEYBOARD_HELP = [
  { keys: 'ARROW KEYS / WASD', action: 'STEER THE FIELD' },
  { keys: 'Q / E', action: 'EXPAND / COMPRESS' },
  { keys: 'SPACE (HOLD)', action: 'GRAB THE HOLOGRAM' },
  { keys: 'V', action: 'ENERGY ARC (TWO FINGER)' },
  { keys: 'X', action: 'OVERDRIVE (VICTORY)' },
  { keys: 'Y', action: 'CONFIRM (THUMB UP)' },
  { keys: '1 – 4', action: 'SELECT VISUAL MODE' },
  { keys: '[ / ]', action: 'PREVIOUS / NEXT MODE' },
  { keys: 'C', action: 'START / STOP CAMERA' },
  { keys: 'M', action: 'TOGGLE SOUND' },
  { keys: 'R', action: 'RESET EXPERIENCE' },
  { keys: 'H', action: 'GESTURE MAP' },
  { keys: 'T', action: 'REPLAY TUTORIAL' },
  { keys: 'ESC', action: 'CLOSE PANELS' },
];

export const TUTORIAL_STEPS = [
  {
    title: 'THE OPTICAL SENSOR',
    body: 'WONDER/SNAP reads 21 landmarks per hand directly in your browser. Nothing is uploaded — the camera stream never leaves this device.',
    hint: 'Press INITIALIZE CAMERA and allow access.',
  },
  {
    title: 'ONE HAND, MANY COMMANDS',
    body: 'Hold an open palm to expand the universe. Close your fist to compress it into a sphere. Pinch thumb and index together to grab the central hologram and move it around.',
    hint: 'Gestures must be held for ~130 ms to register.',
  },
  {
    title: 'SIGNALS & MODES',
    body: 'Two fingers up fire an energy arc between your fingertips. Victory (two fingers apart) engages overdrive. A thumbs up confirms. Swipe sideways to switch visual modes.',
    hint: 'Try the mode selector at the bottom at any time.',
  },
  {
    title: 'TWO HANDS',
    body: 'Raise both hands. Pull them apart to expand the field, bring them together to collapse it. Pinching with both hands lets you frame the hologram between your fingers.',
    hint: 'No camera? Arrow keys and Q/E drive the same systems.',
  },
];

export const STORAGE_KEYS = {
  tutorial: 'wondersnap.tutorial.v2',
  sound: 'wondersnap.sound.v2',
};
