'use client';

import { useEffect, useRef } from 'react';

import { ensureGuestSession } from '@/lib/guest-session';

/**
 * Establishes the guest session for gameplay (spec §7.5, §13 Phase 0).
 *
 * Mounted on game routes only, never in the shared layout. §7.5 asks for a
 * guest session "on first visit ... so play works with zero signup"; the
 * requirement it exists to serve is that "a brand-new visitor can play a full
 * bot game without registering". Creating the identity when a game is entered
 * satisfies that with no added friction, while leaving the landing page, FAQ
 * and How to Play free of database writes — which is what §11 asks for on both
 * cost ("costs scale with real usage, not idle") and privacy ("minimal PII",
 * given that each session row stores an IP address and user agent).
 *
 * An existing session is always reused, so a returning guest keeps their
 * identity across reloads, locales and content pages.
 *
 * Renders nothing and blocks nothing: the session is a side effect the game
 * does not wait on. If it fails — no database, offline, auth down — the app
 * carries on exactly as before.
 */
export function GuestSessionProvider() {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    void ensureGuestSession().then((outcome) => {
      if (outcome.status === 'unavailable' && process.env.NODE_ENV === 'development') {
        console.info(`[guest-session] not established: ${outcome.reason}`);
      }
    });
  }, []);

  return null;
}
