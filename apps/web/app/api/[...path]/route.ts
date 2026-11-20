// Hosted mode only (FUSE_HOSTED=1): serve /api/* from the in-process FUSE API bundle (apps/web/embedded, built by
// scripts/hosted/build-embedded.mjs). Locally, next.config rewrites /api/* to the standalone API server instead.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
type Embedded = { handle: (root: string, r: { method: string; url: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: Record<string, string>; body: string }> };
let mod: Promise<Embedded> | null = null;
const dir = () => join(process.cwd(), 'embedded');

async function serve(req: Request) {
  if (process.env.FUSE_HOSTED !== '1') return Response.json({ error: 'API_OFFLINE', message: 'start the FUSE API (pnpm dev:api) or set FUSE_HOSTED=1' }, { status: 503 });
  mod ??= import(/* webpackIgnore: true */ pathToFileURL(join(dir(), 'fuse-api.mjs')).href) as Promise<Embedded>;
  const u = new URL(req.url);
  const headers: Record<string, string> = {}; req.headers.forEach((v, k) => { if (!['host', 'connection', 'content-length'].includes(k)) headers[k] = v; });
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  const r = await (await mod).handle(dir(), { method: req.method, url: u.pathname + u.search, headers, ...(body ? { body } : {}) });
  return new Response(r.body, { status: r.status, headers: r.headers });
}
export { serve as GET, serve as POST, serve as PUT, serve as DELETE, serve as PATCH };
