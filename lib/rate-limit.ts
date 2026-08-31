/**
 * Minimal per-instance rate limiter.
 *
 * WHY THIS EXISTS: tcgapi.dev's licence forbids operating "an API, feed, file
 * dump, or export that serves our pricing data to third parties", and the test
 * they give is whether someone could use our product instead of subscribing to
 * them. An open, unlimited /api/search would be exactly that. See
 * docs/CATALOG.md.
 *
 * HONEST LIMITATION: this is in-memory, so on Vercel it is per serverless
 * instance and resets on cold start. It raises the cost of casual abuse; it is
 * NOT a real quota. Before launch this must move to shared storage (Vercel KV
 * or Upstash), and once accounts exist the endpoint should require a session.
 * Tracked in docs/ROADMAP.md Phase 4.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit = 30, windowMs = 60_000):
  { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return { allowed: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }
  b.count += 1;
  return { allowed: b.count <= limit, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

/** Best-effort client identity for rate limiting. */
export function clientKey(req: Request): string {
  const h = req.headers;
  return (
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    'unknown'
  );
}
