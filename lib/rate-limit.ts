/**
 * Minimal fixed-window rate limiter kept in process memory.
 *
 * Best-effort: on serverless platforms each instance has its own memory, so
 * this slows down abuse rather than guaranteeing a global limit. Swap for a
 * shared store (e.g. Upstash Redis) if you need strict limits.
 */
export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function check(key: string, now = Date.now()): { allowed: boolean; retryAfterS: number } {
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterS: 0 };
    }
    entry.count++;
    return { allowed: entry.count <= limit, retryAfterS: Math.ceil((entry.resetAt - now) / 1000) };
  };
}
