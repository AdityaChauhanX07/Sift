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
 */
import fs from "node:fs";
import path from "node:path";
import type { SiftResult } from "./types";

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

/** Write the whole store, creating src/data/ if needed. */
function writeStore(store: CacheStore): void {
  fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(store, null, 2), "utf8");
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
