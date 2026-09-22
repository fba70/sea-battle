import { networkInterfaces } from 'node:os';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Every non-internal IPv4 address this machine currently has.
 *
 * Next 16 refuses cross-origin requests for dev resources unless the origin is
 * listed here, and a blocked HMR bootstrap stops the client bundle hydrating —
 * every button, the FAQ accordion and the locale switcher go dead while the
 * server-rendered HTML still looks correct. That makes testing the dev server
 * from a phone on the same Wi-Fi impossible without this.
 *
 * Computed rather than hard-coded so it follows the machine onto any network.
 * Dev-only: Next ignores it in production builds.
 */
function localNetworkOrigins(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => net!.address);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: localNetworkOrigins(),
};

export default withNextIntl(nextConfig);
