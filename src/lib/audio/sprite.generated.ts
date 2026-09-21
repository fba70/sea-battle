// GENERATED FILE — do not edit by hand.
// Run `npm run generate:sfx` to regenerate from scripts/generate-sfx.mjs.
//
// Offsets into public/audio/sfx.wav, in milliseconds: [start, duration].

export const SFX_SRC = '/audio/sfx.wav';

export const SFX_SPRITE = {
  place: [0, 120],
  invalid: [180, 190],
  fire: [430, 130],
  miss: [620, 300],
  hit: [980, 220],
  sink: [1260, 620],
  yourTurn: [1940, 230],
  victory: [2230, 660],
  defeat: [2950, 760],
  click: [3770, 50],
} as const;

export type SoundId = keyof typeof SFX_SPRITE;

export const SOUND_IDS = Object.keys(SFX_SPRITE) as SoundId[];
