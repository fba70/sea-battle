import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { encodeGameState } from '@/game/codec';
import { BOARD_SIZE, FLEET } from '@/game/constants';
import { createGame } from '@/game/state';
import { FLEET_A, FLEET_B } from '@/game/testing/fixtures';
import { startedGame } from '@/game/testing/harness';
import type { BotDifficulty } from '@/game/bot/types';
import type { ResultReason } from '@/game/types';

import { user } from './auth';
import {
  games,
  ratings,
  BOT_LEVELS,
  CLASSIC_RULESET,
  GAME_MODES,
  GAME_STATUSES,
  GAME_TYPES,
  RESULT_REASONS,
  type NewGameRow,
  type NewRatingRow,
} from './game';

const gamesConfig = getTableConfig(games);
const ratingsConfig = getTableConfig(ratings);
const userConfig = getTableConfig(user);

const columnNames = (config: { columns: { name: string }[] }) =>
  config.columns.map((column) => column.name);
const checkNames = (config: { checks: { name: string }[] }) =>
  config.checks.map((check) => check.name);

describe('games table shape (spec §6)', () => {
  it('carries every column spec §6 lists for a game', () => {
    expect(columnNames(gamesConfig)).toEqual(
      expect.arrayContaining([
        'id',
        'mode',
        'type',
        'rated',
        'player_a_id',
        'player_b_id',
        'winner_id',
        'result_reason',
        'started_at',
        'ended_at',
        'move_count',
        'ruleset_json',
        'boards_json',
        'rating_delta_a',
        'rating_delta_b',
      ]),
    );
  });

  it('stores the bot level spec §6 asks for but never names a column for', () => {
    expect(columnNames(gamesConfig)).toContain('bot_level');
  });

  it('keeps the seats nullable so a GDPR erasure cannot destroy the opponent history', () => {
    // Spec §11 requires an erasure path. ON DELETE SET NULL is only expressible if
    // the columns accept null.
    const seats = gamesConfig.columns.filter((column) =>
      ['player_a_id', 'player_b_id', 'winner_id'].includes(column.name),
    );
    expect(seats).toHaveLength(3);
    for (const seat of seats) {
      expect(seat.notNull, seat.name).toBe(false);
    }
  });

  it('indexes history lookups by seat and end time, as spec §6 requires', () => {
    const indexes = gamesConfig.indexes.map((index) => index.config.name);
    expect(indexes).toContain('games_player_a_ended_at_idx');
    expect(indexes).toContain('games_player_b_ended_at_idx');
  });

  it('constrains the impossible records rather than trusting application code', () => {
    expect(checkNames(gamesConfig)).toEqual(
      expect.arrayContaining([
        'games_mode_valid',
        'games_type_valid',
        'games_status_valid',
        'games_result_reason_valid',
        'games_bot_level_valid',
        'games_bot_shape',
        'games_bot_games_unrated',
        'games_rating_delta_requires_rated',
        'games_winner_is_a_player',
        'games_status_coherent',
        'games_move_count_non_negative',
      ]),
    );
  });

  it('defaults a new game to unrated Classic and live', () => {
    const byName = new Map(gamesConfig.columns.map((column) => [column.name, column]));
    expect(byName.get('mode')?.default).toBe('classic');
    expect(byName.get('status')?.default).toBe('live');
    expect(byName.get('rated')?.default).toBe(false);
    expect(byName.get('move_count')?.default).toBe(0);
  });
});

describe('the enum lists stay in step with the engine', () => {
  it('matches the engine ResultReason union', () => {
    // If the engine gains a reason, this assignment stops compiling.
    const fromEngine: readonly ResultReason[] = RESULT_REASONS;
    expect([...fromEngine].sort()).toEqual(['disconnect', 'forfeit', 'sunk_all', 'timeout'].sort());
  });

  it('matches the engine BotDifficulty union', () => {
    const fromEngine: readonly BotDifficulty[] = BOT_LEVELS;
    expect([...fromEngine].sort()).toEqual(['easy', 'hard', 'medium'].sort());
  });

  it('lists Classic and the Phase 2 Salvo mode, and nothing else', () => {
    expect([...GAME_MODES]).toEqual(['classic', 'salvo']);
  });

  it('lists the three game types from spec §6', () => {
    expect([...GAME_TYPES]).toEqual(['bot', 'private', 'quickmatch']);
  });

  it('keeps row lifecycle separate from the engine phase', () => {
    // GamePhase is placement/playing/finished; the row lifecycle is not the same thing.
    expect([...GAME_STATUSES]).toEqual(['live', 'completed', 'aborted']);
  });
});

describe('ruleset_json records what the engine actually implements', () => {
  it('derives the board and fleet from the engine constants, inventing nothing', () => {
    expect(CLASSIC_RULESET.boardSize).toBe(BOARD_SIZE);
    expect(CLASSIC_RULESET.fleet).toEqual(
      FLEET.map((entry) => ({
        shipClass: entry.shipClass,
        size: entry.size,
        count: entry.count,
      })),
    );
  });

  it('records the Classic extra-turn rule spec §4 asks to keep as a flag', () => {
    expect(CLASSIC_RULESET.hitGrantsExtraTurn).toBe(true);
  });

  it('is JSON-native', () => {
    expect(JSON.parse(JSON.stringify(CLASSIC_RULESET))).toEqual(CLASSIC_RULESET);
  });
});

describe('boards_json is the Block 1 codec output, not a second serialiser', () => {
  it('accepts an encoded state directly', () => {
    const state = startedGame(FLEET_A, FLEET_B);
    const row: NewGameRow = {
      type: 'quickmatch',
      boards: encodeGameState(state),
      ruleset: CLASSIC_RULESET,
    };

    // The column's type is EncodedGameState, so this only compiles because the codec
    // produces exactly that shape.
    expect(row.boards?.v).toBe(1);
    expect(row.boards?.boards.a.ships).toHaveLength(10);
  });

  it('survives the jsonb round trip the database will perform', () => {
    const encoded = encodeGameState(startedGame(FLEET_A, FLEET_B));
    // jsonb stores and returns JSON, so anything the codec emits must be JSON-native.
    expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded);
  });

  it('holds the full authoritative state, not just the final grids', () => {
    // The column is named boards_json per spec §6, but a resumable game needs the
    // shots and revealed-empty sets too, which is exactly what the codec carries.
    const encoded = encodeGameState(createGame());
    expect(encoded).toHaveProperty('boards.a.shots');
    expect(encoded).toHaveProperty('boards.a.revealedEmpty');
    expect(encoded).toHaveProperty('moveCount');
  });
});

describe('ratings are per registered player, per mode', () => {
  it('is keyed (user_id, mode) so Salvo is additive rather than a redesign', () => {
    expect(ratingsConfig.primaryKeys).toHaveLength(1);
    expect(ratingsConfig.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      'user_id',
      'mode',
    ]);
  });

  it('defaults to Classic at the Glicko starting values named in spec §6', () => {
    const byName = new Map(ratingsConfig.columns.map((column) => [column.name, column]));
    expect(byName.get('mode')?.default).toBe('classic');
    expect(byName.get('rating')?.default).toBe(1500);
    expect(byName.get('rd')?.default).toBe(350);
    expect(byName.get('games_rated')?.default).toBe(0);
  });

  it('stores what a later Glicko block will need without deciding any of it', () => {
    const names = columnNames(ratingsConfig);
    expect(names).toContain('last_rating_period_at');
    expect(names).toContain('games_rated');
    // Reserved for Glicko-2 per spec §6; Glicko-1 does not use it.
    expect(names).toContain('volatility');
    // No system constant, rating-period length or provisional threshold is encoded:
    // those are unresolved product decisions for a later block.
    expect(names).not.toContain('system_constant_c');
    expect(names).not.toContain('rating_period_days');
    expect(names).not.toContain('provisional');
  });

  it('cannot be held by a guest, enforced by the database rather than by code', () => {
    // A CHECK cannot read another table, so the guard is a composite foreign key into
    // (user.id, user.is_anonymous) with this side pinned to false.
    expect(checkNames(ratingsConfig)).toContain('ratings_owner_is_registered');

    const guard = ratingsConfig.foreignKeys
      .map((key) => key.reference())
      .find((reference) =>
        reference.columns.some((column) => column.name === 'owner_is_anonymous'),
      );

    expect(guard).toBeDefined();
    expect(guard?.columns.map((column) => column.name)).toEqual(['user_id', 'owner_is_anonymous']);
    expect(guard?.foreignColumns.map((column) => column.name)).toEqual(['id', 'is_anonymous']);
  });

  it('has a unique target on user for that foreign key to point at', () => {
    const unique = userConfig.uniqueConstraints.find(
      (constraint) => constraint.name === 'user_id_is_anonymous_key',
    );
    expect(unique?.columns.map((column) => column.name)).toEqual(['id', 'is_anonymous']);
  });

  it('indexes the leaderboard read spec §6 calls for, scoped per mode', () => {
    const index = ratingsConfig.indexes.find(
      (entry) => entry.config.name === 'ratings_mode_rating_idx',
    );
    expect(index).toBeDefined();
  });

  it('only needs a user id and mode to create — the rest defaults', () => {
    const row: NewRatingRow = { userId: 'some-user-id' };
    expect(row.userId).toBe('some-user-id');
  });
});

describe('the new user columns are additive only', () => {
  it('adds the spec §6 profile fields as nullable', () => {
    const byName = new Map(userConfig.columns.map((column) => [column.name, column]));
    for (const name of [
      'avatar_seed',
      'country',
      'locale',
      'last_seen_at',
      'claimed_from_guest_id',
    ]) {
      expect(byName.get(name), name).toBeDefined();
      expect(byName.get(name)?.notNull, name).toBe(false);
    }
  });

  it('does not add a second display-name column — better-auth `name` serves that', () => {
    expect(columnNames(userConfig)).not.toContain('display_name');
  });

  it('constrains locale to the five locales spec §7.14 defines', () => {
    expect(checkNames(userConfig)).toContain('user_locale_valid');
  });

  it('leaves the better-auth columns untouched', () => {
    expect(columnNames(userConfig)).toEqual(
      expect.arrayContaining([
        'id',
        'name',
        'email',
        'email_verified',
        'image',
        'is_anonymous',
        'created_at',
        'updated_at',
      ]),
    );
  });
});
