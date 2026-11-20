import type { NextConfig } from 'next';
const api = process.env.FUSE_API ?? 'http://127.0.0.1:8787';
const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
