import { describe, expect, it } from 'vitest';

import { BOARD_SIZE, FLEET } from '@/game/constants';
import { FLEET_A } from '@/game/testing/fixtures';

import {
  clientIntentSchema,
  clientMessageSchema,
  parseClientMessage,
  shipPlacementSchema,
  GAME_INTENTS,
  MAX_CELLS_PER_FIRE,
  MAX_PLACEMENTS_PER_INTENT,
  TRANSPORT_INTENTS,
} from './protocol';

const FIRE = { seq: 0, intent: { type: 'fire', cells: [{ x: 1, y: 2 }] } };

describe('clientIntentSchema covers the spec §9 client→server set', () => {
  it('names every intent §9 lists, and nothing else', () => {
    expect([...GAME_INTENTS, ...TRANSPORT_INTENTS].sort()).toEqual(
      ['fire', 'heartbeat', 'join', 'place_fleet', 'react', 'ready', 'resign'].sort(),
    );
  });

  for (const intent of [
    { type: 'join', gameId: 'abc' },
    { type: 'place_fleet', placements: [...FLEET_A] },
    { type: 'ready' },
    { type: 'fire', cells: [{ x: 0, y: 0 }] },
    { type: 'react', emoji: '🔥' },
    { type: 'resign' },
    { type: 'heartbeat' },
  ]) {
    it(`accepts a well-formed '${String(intent.type)}'`, () => {
      expect(clientIntentSchema.safeParse(intent).success).toBe(true);
    });
  }
});

describe('shipPlacementSchema', () => {
  it('accepts every ship class the engine defines', () => {
    // Guards against the schema's literal list drifting from src/game/types.ts.
    for (const entry of FLEET) {
      const parsed = shipPlacementSchema.safeParse({
        shipClass: entry.shipClass,
        origin: { x: 0, y: 0 },
        orientation: 'horizontal',
      });
      expect(parsed.success, entry.shipClass).toBe(true);
    }
  });

  it('rejects a ship class the engine does not define', () => {
    const parsed = shipPlacementSchema.safeParse({
      shipClass: 'dreadnought',
      origin: { x: 0, y: 0 },
      orientation: 'horizontal',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects a diagonal orientation', () => {
    const parsed = shipPlacementSchema.safeParse({
      shipClass: 'submarine',
      origin: { x: 0, y: 0 },
      orientation: 'diagonal',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('the schema validates structure, not Battleship rules', () => {
  it('lets an off-board coordinate through so the engine can name it out_of_bounds', () => {
    // Deliberate: bounds are `fire()`'s and `validateFleet()`'s rule. If the schema
    // clamped them, a cheating client would get an anonymous `malformed_intent`
    // instead of the precise code spec §9 asks the server to return.
    const parsed = clientIntentSchema.safeParse({
      type: 'fire',
      cells: [{ x: BOARD_SIZE + 5, y: -3 }],
    });
    expect(parsed.success).toBe(true);
  });

  it('lets a wrong-sized fleet through so the engine can name the composition error', () => {
    const parsed = clientIntentSchema.safeParse({
      type: 'place_fleet',
      placements: FLEET_A.slice(0, 3),
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an empty fleet proposal — the engine rejects it as a composition error', () => {
    expect(clientIntentSchema.safeParse({ type: 'place_fleet', placements: [] }).success).toBe(
      true,
    );
  });
});

describe('the schema rejects malformed and unreasonable payloads', () => {
  const CASES: readonly (readonly [string, unknown])[] = [
    ['a non-object message', 'fire'],
    ['null', null],
    ['an array', []],
    ['a missing seq', { intent: { type: 'ready' } }],
    ['a negative seq', { seq: -1, intent: { type: 'ready' } }],
    ['a fractional seq', { seq: 1.5, intent: { type: 'ready' } }],
    ['an infinite seq', { seq: Number.POSITIVE_INFINITY, intent: { type: 'ready' } }],
    ['a NaN seq', { seq: Number.NaN, intent: { type: 'ready' } }],
    ['a missing intent', { seq: 0 }],
    ['an unknown intent type', { seq: 0, intent: { type: 'nuke' } }],
    ['a missing intent type', { seq: 0, intent: { cells: [] } }],
    ['an unknown key on the envelope', { ...FIRE, token: 'secret' }],
    ['an unknown key on the intent', { seq: 0, intent: { type: 'ready', cheat: true } }],
    [
      'an unknown key on a coordinate',
      { seq: 0, intent: { type: 'fire', cells: [{ x: 0, y: 0, z: 1 }] } },
    ],
    ['a string coordinate', { seq: 0, intent: { type: 'fire', cells: [{ x: '0', y: 0 }] } }],
    ['a fractional coordinate', { seq: 0, intent: { type: 'fire', cells: [{ x: 0.5, y: 0 }] } }],
    ['a null coordinate', { seq: 0, intent: { type: 'fire', cells: [null] } }],
    ['cells that are not an array', { seq: 0, intent: { type: 'fire', cells: { x: 0, y: 0 } } }],
    ['an empty salvo', { seq: 0, intent: { type: 'fire', cells: [] } }],
    [
      'an oversized salvo',
      {
        seq: 0,
        intent: {
          type: 'fire',
          cells: Array.from({ length: MAX_CELLS_PER_FIRE + 1 }, (_, i) => ({ x: i % 10, y: 0 })),
        },
      },
    ],
    [
      'an absurd number of placements',
      {
        seq: 0,
        intent: {
          type: 'place_fleet',
          placements: Array.from({ length: MAX_PLACEMENTS_PER_INTENT + 1 }, () => ({
            shipClass: 'submarine',
            origin: { x: 0, y: 0 },
            orientation: 'horizontal',
          })),
        },
      },
    ],
    [
      'placements that are not an array',
      { seq: 0, intent: { type: 'place_fleet', placements: 7 } },
    ],
    ['an empty emoji', { seq: 0, intent: { type: 'react', emoji: '' } }],
    ['an oversized emoji payload', { seq: 0, intent: { type: 'react', emoji: 'x'.repeat(500) } }],
    ['an empty gameId on join', { seq: 0, intent: { type: 'join', gameId: '' } }],
  ];

  for (const [label, payload] of CASES) {
    it(`rejects ${label}`, () => {
      expect(clientMessageSchema.safeParse(payload).success).toBe(false);
    });
  }

  it('rejects a join that smuggles an auth token — the session never sees credentials', () => {
    // §9 writes `join { gameId, token }`, but the token authenticates the *connection*
    // and belongs to the adapter (§5.2). A strict schema keeps it out of this layer.
    expect(
      clientIntentSchema.safeParse({ type: 'join', gameId: 'g', token: 'secret' }).success,
    ).toBe(false);
  });
});

describe('parseClientMessage', () => {
  it('returns the parsed message on success', () => {
    const parsed = parseClientMessage(FIRE);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.message.intent.type).toBe('fire');
      expect(parsed.message.seq).toBe(0);
    }
  });

  it('reports a malformed_intent with a field path and no echoed input', () => {
    const secret = 'super-secret-token-value';
    const parsed = parseClientMessage({ seq: 0, intent: { type: 'react', emoji: secret } });

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('malformed_intent');
      expect(parsed.error.message).toContain('emoji');
      // The value that failed must never be reflected back into a message or a log.
      expect(parsed.error.message).not.toContain(secret);
    }
  });

  it('is deterministic for the same bad input', () => {
    const bad = { seq: 0, intent: { type: 'fire', cells: [] } };
    expect(parseClientMessage(bad)).toEqual(parseClientMessage(bad));
  });

  it('strips nothing it accepted — the parsed intent matches the input', () => {
    const parsed = parseClientMessage({
      seq: 4,
      intent: { type: 'place_fleet', placements: [...FLEET_A] },
    });

    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.message.intent.type === 'place_fleet') {
      expect(parsed.message.intent.placements).toEqual(FLEET_A);
    }
  });
});
