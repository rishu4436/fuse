import type { NextConfig } from 'next';
const api = process.env.FUSE_API ?? 'http://127.0.0.1:8787';
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(config) {
    // libauth (used by WizardConnect) relies on top-level await + WebAssembly.
    config.experiments = { ...config.experiments, topLevelAwait: true, asyncWebAssembly: true };
    config.output = { ...config.output, environment: { ...(config.output?.environment ?? {}), asyncFunction: true } };
    return config;
  },
  async redirects() {
    return [
      ['/studio', '/app/execute/new'], ['/auctions', '/app/execute'], ['/auctions/:id', '/app/execute/:id'], ['/solvers', '/app/solvers'],
      ['/vault', '/app/liquidity/flashvault-bch'], ['/certificates', '/app/certificates'], ['/certificates/:id', '/app/certificates/:id'],
      ['/mainnet', '/app/opportunities'], ['/guardian', '/app/guardian'], ['/activity', '/app/activity'],
    ].map(([source, destination]) => ({ source, destination, permanent: false }));
  },
  async rewrites() { return [{ source: '/api/:path*', destination: `${api}/api/:path*` }]; },
  async headers() {
    return [{ source: '/(.*)', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};
export default config;
