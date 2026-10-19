import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Spec §7.14 puts `users.locale` ahead of the cookie, so this endpoint is what
 * makes a language choice follow someone to another device. What matters is that
 * it belongs to a session and refuses anything that is not one of the five
 * languages the app actually ships.
 */
const getSession = vi.fn();
const updateWhere = vi.fn(async () => undefined);
const set = vi.fn(() => ({ where: updateWhere }));
const selectRows = vi.fn(async () => [] as { locale: string | null }[]);

vi.mock('@/lib/auth', () => ({ auth: { api: { getSession } } }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/db', () => ({
  db: {
    update: () => ({ set }),
    select: () => ({ from: () => ({ where: () => ({ limit: selectRows }) }) }),
  },
}));

async function put(body: unknown): Promise<Response> {
  const { PUT } = await import('./route');
  return PUT(
    new Request('https://seaduel.test/api/account/locale', {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.resetModules();
  getSession.mockReset();
  set.mockClear();
  updateWhere.mockClear();
  selectRows.mockReset();
  selectRows.mockResolvedValue([]);
});

describe('saving the language', () => {
  it('refuses when nobody is signed in', async () => {
    getSession.mockResolvedValue(null);

    expect((await put({ locale: 'de' })).status).toBe(401);
    expect(set).not.toHaveBeenCalled();
  });

  it('saves one of the five languages the app ships', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-a' } });

    const response = await put({ locale: 'fr' });

    expect(response.status).toBe(200);
    expect(set).toHaveBeenCalledWith({ locale: 'fr' });
  });

  it('refuses a language the app does not have', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-a' } });

    // Spec §7.14 is explicit that there is no Russian, and the column has a
    // CHECK saying the same — this gives a clean refusal instead of a crash.
    expect((await put({ locale: 'ru' })).status).toBe(422);
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses anything that is not a language at all', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-a' } });

    for (const bad of [{ locale: 42 }, { locale: null }, {}, { locale: 'en-GB' }]) {
      expect((await put(bad)).status, JSON.stringify(bad)).toBe(422);
    }
    expect(set).not.toHaveBeenCalled();
  });

  it('refuses a malformed body rather than throwing', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-a' } });
    expect((await put('not json at all')).status).toBe(400);
  });
});

describe('reading the language back', () => {
  async function get(): Promise<Response> {
    const { GET } = await import('./route');
    return GET();
  }

  it('refuses when nobody is signed in', async () => {
    getSession.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it('reports the saved language', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-a' } });
    selectRows.mockResolvedValue([{ locale: 'it' }]);

    expect(await (await get()).json()).toEqual({ locale: 'it' });
  });

  it('reports null for an account that never chose one', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-a' } });
    selectRows.mockResolvedValue([{ locale: null }]);

    // Null means "no preference", which leaves the cookie and the browser's own
    // languages to decide — not a silent fallback to English.
    expect(await (await get()).json()).toEqual({ locale: null });
  });
});
