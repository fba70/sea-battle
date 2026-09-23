'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { useRouter } from '@/i18n/navigation';

/** Create a private room, or join one by code (spec §7.4). */
export function RoomLobby() {
  const t = useTranslations('multiplayer.room');
  const router = useRouter();
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function create(): Promise<void> {
    setBusy('create');
    setError(null);
    try {
      const response = await fetch('/api/room', { method: 'POST' });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? 'unknown');
        return;
      }
      const room = (await response.json()) as { code: string };
      router.push(`/play/room/${room.code}`);
    } catch {
      setError('unknown');
    } finally {
      setBusy(null);
    }
  }

  function join(event: React.FormEvent): void {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length === 0) {
      return;
    }
    // The room page performs the join, so a shared link and a typed code follow
    // exactly the same path.
    router.push(`/play/room/${trimmed.toUpperCase()}`);
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>

      <button
        type="button"
        onClick={() => void create()}
        disabled={busy !== null}
        className="bg-primary text-primary-foreground mt-6 w-full rounded-md px-4 py-2.5 font-medium disabled:opacity-50"
      >
        {busy === 'create' ? t('creating') : t('create')}
      </button>

      <form onSubmit={join} className="mt-8">
        <label htmlFor="room-code" className="block text-sm font-medium">
          {t('joinTitle')}
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="room-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('codePlaceholder')}
            aria-label={t('codeInput')}
            autoComplete="off"
            autoCapitalize="characters"
            className="border-border w-full rounded-md border px-3 py-2 font-mono tracking-widest uppercase"
          />
          <button type="submit" className="border-border rounded-md border px-4 py-2 font-medium">
            {t('join')}
          </button>
        </div>
      </form>

      {error ? (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {t(`errors.${error}` as 'errors.unknown')}
        </p>
      ) : null}
    </main>
  );
}
