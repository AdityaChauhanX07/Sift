/**
 * Tiny file-backed cache for Sift results.
 *
 * Backs the "golden demo query" — we pre-compute an investigation offline and
 * serve it instantly, so the demo works even when Nimble or Groq is down. The
 * store is a plain JSON object at src/data/cache.json, keyed by the lowercased,
 * trimmed query string.
 *
 * This is intentionally simple (synchronous fs, no eviction, no TTL): the cache
 * holds a handful of curated queries, not arbitrary user traffic.
 *
 * Serverless / Vercel behavior:
 *  - READS work in production. cache.json is committed and present at build
 *    time, and next.config's `outputFileTracingIncludes` bundles it into the
 *    function, so the process.cwd()-relative path below resolves to it. If the
 *    file is ever missing at runtime, readStore() degrades to an empty cache
 *    instead of throwing — the golden demo just wouldn't be pre-served.
 *  - WRITES are best-effort. Vercel's function filesystem is READ-ONLY, so the
 *    write below throws (EROFS) and is swallowed: live-query results aren't
 *    persisted in production. That's fine — the golden demo cache is baked in at
 *    build time, and live queries still return their result, just uncached.
 *    Locally the filesystem is writable, so `enrich:golden` etc. work normally.
 */
import fs from "node:fs";
import path from "node:path";
import type { SiftResult } from "./types";

// Resolved from the project root. The file exists at build time and is traced
// into the serverless bundle (see next.config.mjs outputFileTracingIncludes).
const CACHE_PATH = path.join(process.cwd(), "src", "data", "cache.json");

/** Map of normalized query -> cached SiftResult. */
type CacheStore = Record<string, SiftResult>;

/** Normalize a query into its cache key. */
function cacheKey(query: string): string {
  return query.trim().toLowerCase();
}

/** Read the whole store, returning an empty object if it's missing/corrupt. */
function readStore(): CacheStore {
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CacheStore) : {};
  } catch {
    // No file yet, or unreadable/invalid JSON — treat as an empty cache.
    return {};
  }
}

/**
 * Write the whole store, creating src/data/ if needed.
 *
 * Best-effort: on a read-only serverless filesystem (Vercel) this throws EROFS,
 * which we swallow — live results just go uncached there. Locally the FS is
 * writable, so the cache persists as normal.
 */
function writeStore(store: CacheStore): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    // Read-only filesystem (Vercel) or any I/O error — caching is optional.
    console.warn(
      `[cache] skipped persisting result (read-only filesystem?): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Return the cached result for `query`, or null on a miss. */
export function getCachedResult(query: string): SiftResult | null {
  const store = readStore();
  return store[cacheKey(query)] ?? null;
}

/** Store `result` under `query`, overwriting any existing entry. */
export function setCachedResult(query: string, result: SiftResult): void {
  const store = readStore();
  store[cacheKey(query)] = result;
  writeStore(store);
}
