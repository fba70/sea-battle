/**
 * Generates the game's sound-effect sprite.
 *
 * Every sample here is synthesised from scratch (sine tones, filtered noise and
 * envelopes) by this script. Nothing is downloaded, sampled or derived from a
 * third-party recording, so the resulting audio is original project content with
 * no external licence attached.
 *
 * Run with:  node scripts/generate-sfx.mjs
 * Outputs:   public/audio/sfx.wav  +  src/lib/audio/sprite.generated.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_RATE = 22050;
const GAP_SECONDS = 0.06;

// ---------------------------------------------------------------- primitives

const clamp = (value) => Math.max(-1, Math.min(1, value));

function silence(seconds) {
  return new Float32Array(Math.round(seconds * SAMPLE_RATE));
}

/** Exponential decay envelope with a short attack, so nothing clicks. */
function envelope(length, { attack = 0.004, decay = 1, curve = 4 } = {}) {
  const attackSamples = Math.max(1, Math.round(attack * SAMPLE_RATE));
  const out = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const attackGain = i < attackSamples ? i / attackSamples : 1;
    const t = i / length;
    out[i] = attackGain * Math.pow(1 - t, curve) * decay;
  }
  return out;
}

function tone(seconds, { from, to = from, gain = 1, shape = 'sine', ...env }) {
  const length = Math.round(seconds * SAMPLE_RATE);
  const buffer = new Float32Array(length);
  const amp = envelope(length, env);
  let phase = 0;

  for (let i = 0; i < length; i += 1) {
    const t = i / length;
    const frequency = from + (to - from) * t;
    phase += (2 * Math.PI * frequency) / SAMPLE_RATE;

    const raw = shape === 'square' ? Math.sign(Math.sin(phase)) * 0.6 : Math.sin(phase);
    buffer[i] = raw * amp[i] * gain;
  }
  return buffer;
}

/** White noise pushed through a one-pole low-pass, for splashes and impacts. */
function noise(seconds, { cutoff = 0.35, gain = 1, seed = 1, ...env }) {
  const length = Math.round(seconds * SAMPLE_RATE);
  const buffer = new Float32Array(length);
  const amp = envelope(length, env);
  let state = 0;
  let rnd = seed >>> 0;

  for (let i = 0; i < length; i += 1) {
    rnd = (Math.imul(rnd, 1664525) + 1013904223) >>> 0;
    const white = (rnd / 0xffffffff) * 2 - 1;
    state += (white - state) * cutoff;
    buffer[i] = state * amp[i] * gain;
  }
  return buffer;
}

function mix(...layers) {
  const length = Math.max(...layers.map((layer) => layer.length));
  const out = new Float32Array(length);
  for (const layer of layers) {
    for (let i = 0; i < layer.length; i += 1) {
      out[i] += layer[i];
    }
  }
  for (let i = 0; i < length; i += 1) {
    out[i] = clamp(out[i]);
  }
  return out;
}

function sequence(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ------------------------------------------------------------------ the kit
// Kept deliberately short and quiet: these play on every shot, so anything
// longer than ~0.3s or louder than ~0.4 peak becomes fatiguing fast.

const SOUNDS = {
  // Soft wooden settle when a ship lands on the grid.
  place: mix(
    tone(0.12, { from: 210, to: 150, gain: 0.32, curve: 5 }),
    noise(0.06, { cutoff: 0.5, gain: 0.1, curve: 6, seed: 11 }),
  ),

  // Low double blip for a rejected placement — clearly negative, not harsh.
  invalid: sequence(
    tone(0.07, { from: 150, gain: 0.26, shape: 'square', curve: 3 }),
    silence(0.03),
    tone(0.09, { from: 120, gain: 0.26, shape: 'square', curve: 3 }),
  ),

  // The launch: a short airy transient.
  fire: mix(
    noise(0.13, { cutoff: 0.75, gain: 0.22, curve: 5, seed: 23 }),
    tone(0.1, { from: 520, to: 180, gain: 0.14, curve: 5 }),
  ),

  // Miss: water splash — filtered noise with a descending bloop underneath.
  miss: mix(
    noise(0.3, { cutoff: 0.22, gain: 0.3, curve: 3, seed: 37 }),
    tone(0.22, { from: 380, to: 150, gain: 0.12, curve: 4 }),
  ),

  // Hit: a hard, close impact.
  hit: mix(
    noise(0.14, { cutoff: 0.85, gain: 0.3, curve: 7, seed: 51 }),
    tone(0.22, { from: 160, to: 70, gain: 0.34, curve: 4 }),
  ),

  // Sink: the impact plus a long descending groan.
  sink: mix(
    noise(0.2, { cutoff: 0.8, gain: 0.22, curve: 7, seed: 67 }),
    tone(0.62, { from: 240, to: 62, gain: 0.32, curve: 2.5 }),
    noise(0.6, { cutoff: 0.08, gain: 0.16, curve: 2, seed: 83 }),
  ),

  // Your turn: two quiet rising pips. Must not startle.
  yourTurn: sequence(
    tone(0.09, { from: 660, gain: 0.12, curve: 4 }),
    silence(0.02),
    tone(0.12, { from: 880, gain: 0.12, curve: 4 }),
  ),

  // Victory: a short rising major triad.
  victory: sequence(
    tone(0.16, { from: 523, gain: 0.2, curve: 3 }),
    tone(0.16, { from: 659, gain: 0.2, curve: 3 }),
    tone(0.34, { from: 784, gain: 0.22, curve: 2.5 }),
  ),

  // Defeat: the same shape, falling and minor.
  defeat: sequence(
    tone(0.18, { from: 392, gain: 0.2, curve: 3 }),
    tone(0.18, { from: 330, gain: 0.2, curve: 3 }),
    tone(0.4, { from: 247, gain: 0.22, curve: 2 }),
  ),

  // Generic UI tick for buttons.
  click: mix(
    tone(0.05, { from: 900, to: 700, gain: 0.12, curve: 6 }),
    noise(0.03, { cutoff: 0.9, gain: 0.05, curve: 6, seed: 97 }),
  ),
};

// -------------------------------------------------------------- sprite build

const gap = silence(GAP_SECONDS);
const chunks = [];
const sprite = {};
let cursor = 0;

for (const [name, samples] of Object.entries(SOUNDS)) {
  const startMs = Math.round((cursor / SAMPLE_RATE) * 1000);
  const durationMs = Math.round((samples.length / SAMPLE_RATE) * 1000);
  sprite[name] = [startMs, durationMs];

  chunks.push(samples, gap);
  cursor += samples.length + gap.length;
}

const track = sequence(...chunks);

// 16-bit mono PCM WAV.
const dataBytes = track.length * 2;
const buffer = Buffer.alloc(44 + dataBytes);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataBytes, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(dataBytes, 40);

for (let i = 0; i < track.length; i += 1) {
  buffer.writeInt16LE(Math.round(clamp(track[i]) * 32767), 44 + i * 2);
}

mkdirSync(resolve(ROOT, 'public/audio'), { recursive: true });
writeFileSync(resolve(ROOT, 'public/audio/sfx.wav'), buffer);

const ts = `// GENERATED FILE — do not edit by hand.
// Run \`npm run generate:sfx\` to regenerate from scripts/generate-sfx.mjs.
//
// Offsets into public/audio/sfx.wav, in milliseconds: [start, duration].

export const SFX_SRC = '/audio/sfx.wav';

export const SFX_SPRITE = {
${Object.entries(sprite)
  .map(([name, [start, duration]]) => `  ${name}: [${start}, ${duration}],`)
  .join('\n')}
} as const;

export type SoundId = keyof typeof SFX_SPRITE;

export const SOUND_IDS = Object.keys(SFX_SPRITE) as SoundId[];
`;

mkdirSync(resolve(ROOT, 'src/lib/audio'), { recursive: true });
writeFileSync(resolve(ROOT, 'src/lib/audio/sprite.generated.ts'), ts);

console.log(
  `sfx.wav: ${(buffer.length / 1024).toFixed(0)} KB, ${Object.keys(sprite).length} sounds, ` +
    `${(track.length / SAMPLE_RATE).toFixed(2)}s`,
);
