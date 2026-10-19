import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The availability check is advisory — sign-up re-checks and a unique index
 * arbitrates — so what matters here is that it never says "yes" to something the
 * real rules would refuse, and that it does not become a way to probe the database.
 */
const isTaken = vi.fn(async () => false);

vi.mock('@/lib/account/name-registry', () => ({
  createDisplayNameRegistry: () => ({ isTaken }),
}));

async function ask(name: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const { GET } = await import('./route');
  const response = await GET(
    new Request(`https://seaduel.test/api/account/name-available?name=${encodeURIComponent(name)}`),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(() => {
  isTaken.mockClear();
  isTaken.mockResolvedValue(false);
  vi.resetModules();
});

describe('name availability', () => {
  it('says yes to a free, valid name', async () => {
    expect(await ask('Mariner')).toMatchObject({ status: 200, body: { available: true } });
  });

  it('says no, and why, to a name that breaks the rules', async () => {
    expect((await ask('ab')).body).toEqual({ available: false, problem: 'too_short' });
    expect((await ask('has space')).body).toEqual({
      available: false,
      problem: 'invalid_characters',
    });
    expect((await ask('Anonymous')).body).toEqual({ available: false, problem: 'reserved' });
  });

  it('does not query the database for a name that could never be valid', async () => {
    await ask('ab');
    expect(isTaken).not.toHaveBeenCalled();
  });

  it('reports a name somebody already holds', async () => {
    isTaken.mockResolvedValue(true);
    expect((await ask('Mariner')).body).toEqual({ available: false, problem: 'taken' });
  });

  it('refuses an absurdly long input before touching anything', async () => {
    expect((await ask('x'.repeat(5000))).body).toEqual({ available: false, problem: 'too_long' });
    expect(isTaken).not.toHaveBeenCalled();
  });

  it('treats a missing name as invalid rather than erroring', async () => {
    const { GET } = await import('./route');
    const response = await GET(new Request('https://seaduel.test/api/account/name-available'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false, problem: 'too_short' });
  });
});
