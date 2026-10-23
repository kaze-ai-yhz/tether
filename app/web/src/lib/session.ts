import 'server-only';

import { cookies } from 'next/headers';

import type { ActingAs } from './types';

// "Acting as" lives in an httpOnly cookie set only by POST /api/session. The server picks the
// token and role from it; a role sent in a request body is never trusted.

export const ACTING_AS_COOKIE = 'tether_acting_as';
export const DEFAULT_ACTING_AS: ActingAs = 'clinician';

export function parseActingAs(value: unknown): ActingAs | null {
  return value === 'agent' || value === 'clinician' ? value : null;
}

/** Reads the cookie (a request-time API, so callers render per request). */
export async function getActingAs(): Promise<ActingAs> {
  const store = await cookies();
  return parseActingAs(store.get(ACTING_AS_COOKIE)?.value) ?? DEFAULT_ACTING_AS;
}

/** Route handlers and server functions only. */
export async function setActingAs(actingAs: ActingAs): Promise<void> {
  const store = await cookies();
  store.set({
    name: ACTING_AS_COOKIE,
    value: actingAs,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 12,
  });
}
