'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientIntent, ServerEvent } from '@/server/session/protocol';
import type { PlayerView } from '@/game/view';
import type { PlayerSlot } from '@/game/types';

/**
 * The browser end of the realtime session (spec §9).
 *
 * Deliberately thin: it opens a socket, forwards intents and keeps whatever the server
 * last told it. It decides nothing — not whose turn it is, not whether a shot is legal,
 * not who won. Every one of those comes back in a `state_snapshot` computed by the
 * Durable Object from the authoritative state, and the only board this hook ever sees
 * is the viewer's own filtered `PlayerView`.
 */

export type LiveStatus = 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'failed';

export interface LiveMatch {
  readonly status: LiveStatus;
  /** Null until the first snapshot arrives — i.e. until both players are present. */
  readonly view: PlayerView | null;
  readonly seat: PlayerSlot | null;
  /** The most recent rejection from the server, for inline feedback. */
  readonly lastError: string | null;
  readonly lastShot: { readonly coord: { x: number; y: number }; readonly at: number } | null;
  send(intent: ClientIntent): void;
  clearError(): void;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

interface TicketResponse {
  ticket: string;
  seat: PlayerSlot;
  gameId: string;
}

/**
 * @param gameId the game to join — issued by the server, never chosen by the browser.
 * @param wsUrl  origin of the realtime Worker, e.g. ws://localhost:8787.
 */
export function useLiveMatch(gameId: string, wsUrl: string): LiveMatch {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [view, setView] = useState<PlayerView | null>(null);
  const [seat, setSeat] = useState<PlayerSlot | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastShot, setLastShot] = useState<LiveMatch['lastShot']>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const seqRef = useRef(0);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  const send = useCallback((intent: ClientIntent) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    seqRef.current += 1;
    socket.send(JSON.stringify({ seq: seqRef.current, intent }));
  }, []);

  const clearError = useCallback(() => setLastError(null), []);

  useEffect(() => {
    closedRef.current = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function connect(): Promise<void> {
      if (closedRef.current) {
        return;
      }

      try {
        // A fresh ticket per attempt: they are short-lived on purpose, and asking
        // again is also how a reconnect re-proves who the player is.
        const response = await fetch(`/api/game/${gameId}/ticket`, { method: 'POST' });
        if (!response.ok) {
          setStatus('failed');
          return;
        }

        const { ticket, seat: assigned } = (await response.json()) as TicketResponse;
        if (closedRef.current) {
          return;
        }
        setSeat(assigned);

        const socket = new WebSocket(
          `${wsUrl}/game/${gameId}/ws?ticket=${encodeURIComponent(ticket)}`,
        );
        socketRef.current = socket;

        socket.onopen = () => {
          attemptRef.current = 0;
          // A snapshot may not come immediately: the room reports `waiting` until the
          // opponent connects too.
          setStatus((current) => (current === 'connected' ? current : 'waiting'));
        };

        socket.onmessage = (event) => {
          const message = JSON.parse(event.data as string) as ServerEvent;

          switch (message.type) {
            case 'state_snapshot':
              setView(message.view);
              setStatus('connected');
              break;
            case 'fire_result': {
              const cell = message.cells[0];
              if (cell) {
                setLastShot({ coord: cell.coord, at: Date.now() });
              }
              break;
            }
            case 'placement_rejected':
              setLastError(message.reason);
              break;
            case 'error':
              // "Waiting for the other player" arrives as an error before the game
              // exists; it is a lobby state, not something to show as a failure.
              if (message.code === 'unsupported_intent') {
                setStatus((current) => (current === 'connected' ? current : 'waiting'));
              } else {
                setLastError(message.code);
              }
              break;
            default:
              break;
          }
        };

        socket.onclose = () => {
          socketRef.current = null;
          if (closedRef.current) {
            return;
          }

          const delay =
            RECONNECT_DELAYS_MS[Math.min(attemptRef.current, RECONNECT_DELAYS_MS.length - 1)];
          attemptRef.current += 1;
          setStatus('reconnecting');
          // Reconnecting is simply connecting again: the server answers with a fresh
          // snapshot, so there is nothing to reconcile on this side.
          retryTimer = setTimeout(() => void connect(), delay);
        };

        socket.onerror = () => {
          socket.close();
        };
      } catch {
        if (!closedRef.current) {
          setStatus('failed');
        }
      }
    }

    void connect();

    return () => {
      closedRef.current = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [gameId, wsUrl]);

  return { status, view, seat, lastError, lastShot, send, clearError };
}
