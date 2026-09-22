import { anonymousClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

/**
 * No explicit baseURL: the client talks to /api/auth on whatever origin the page
 * was loaded from. Pinning it to NEXT_PUBLIC_APP_URL broke every non-localhost
 * origin — opening the dev server from a phone on the LAN made each auth call a
 * cross-origin request to "localhost", which is the phone itself, so it failed
 * CORS. Same-origin is also correct in production and needs no configuration.
 */
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});

export const { signIn, signOut, signUp, useSession } = authClient;
