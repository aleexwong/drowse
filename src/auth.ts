import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** Constant-time compare that also tolerates different lengths. */
export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (!presented) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Where the token can come from, in order:
 *
 *  1. `Authorization: Bearer <token>`
 *  2. `x-api-key: <token>`
 *  3. the URL path, `/mcp/<token>`
 *
 * The path form exists because the Claude custom-connector UI only offers OAuth
 * client id/secret fields — there is nowhere to type a bearer token. A token in
 * the URL is the practical single-user workaround, so treat the whole URL as the
 * secret: never paste it anywhere, and rotate it by changing DROWSE_TOKEN.
 */
export function extractToken(req: Request): string | undefined {
  const header = req.header('authorization');
  if (header) {
    const [scheme, ...rest] = header.split(' ');
    const value = rest.join(' ').trim();
    if (scheme?.toLowerCase() === 'bearer' && value) return value;
  }

  const apiKey = req.header('x-api-key');
  if (apiKey) return apiKey.trim();

  const fromPath = (req.params as Record<string, string | undefined>).token;
  if (fromPath) return decodeURIComponent(fromPath);

  return undefined;
}
