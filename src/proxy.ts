import createMiddleware from 'next-intl/middleware';

import { routing } from '@/i18n/routing';

// Next 16 renamed the `middleware` file convention to `proxy`; next-intl still
// ships the handler factory under its `middleware` entrypoint.
export default createMiddleware(routing);

export const config = {
  // Skip API routes (including better-auth), Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
