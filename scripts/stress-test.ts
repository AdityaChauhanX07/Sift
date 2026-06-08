/**
 * Stress test for Sift's /api/sift pipeline.
 *
 * Exercises the streaming NDJSON endpoint against cached, live, edge-case, and
 * concurrent inputs, printing PASS/FAIL + timing for each scenario and a summary
 * at the end.
 *
 * Prereq: the dev server must already be running. The script auto-detects it on
 * ports 3000-3002 (or set SIFT_BASE_URL / PORT to override).
 *
 * SIDE EFFECT: live queries cause the route to write results into
 * src/data/cache.json. To keep the repo clean, this script snapshots that file
 * up front and RESTORES it on exit — so repeated runs stay live and the golden
 * cache isn't polluted.
 *
 * Run with: npm run test:stress  (after `npm run dev`)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SiftResult } from "../src/lib/types";

const CACHE_PATH = join(process.cwd(), "src", "data", "cache.json");

/** Outcome of one call to the streaming endpoint. */
interface Outcome {
  /** HTTP status (0 if the request itself threw, e.g. timeout). */
  status: number;
  cached: boolean | null;
  data: SiftResult | null;
  error: string | null;
  /** Count of progress events seen (excludes the terminal complete/error). */
  progressEvents: number;
  /** First-seen time (ms from request start) of each distinct stage. */
  timeline: { stage: string; ms: number }[];
}

const enc = (n: number) => `${n.toFixed(0)}ms`;

/** POST a query and consume the NDJSON stream to a terminal outcome. */
async function runQuery(
  base: string,
  query: string,
  timeoutMs = 90_000,
): Promise<Outcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = performance.now();
  const timeline: { stage: string; ms: number }[] = [];
  const seenStages = new Set<string>();

  try {
    const res = await fetch(`${base}/api/sift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    // Validation errors (e.g. empty query) come back as plain JSON, not a stream.
    if (!res.ok || !res.body) {
      let error = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        error = j.error ?? j.detail ?? error;
      } catch {
        /* leave default */
      }
      return { status: res.status, cached: null, data: null, error, progressEvents: 0, timeline };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data: SiftResult | null = null;
    let cached: boolean | null = null;
    let error: string | null = null;
    let progressEvents = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const e = JSON.parse(line);
        if (!seenStages.has(e.stage)) {
          seenStages.add(e.stage);
          timeline.push({ stage: e.stage, ms: performance.now() - start });
        }
        if (e.stage === "complete") {
          data = e.data ?? null;
          cached = e.cached ?? null;
        } else if (e.stage === "error") {
          error = e.message ?? "error event";
        } else {
          progressEvents++;
        }
      }
    }

    return { status: res.status, cached, data, error, progressEvents, timeline };
  } catch (err) {
    return {
      status: 0,
      cached: null,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      progressEvents: 0,
      timeline,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ assertions ------------------------------ */

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** Every result item must carry a valid verdict. */
function assertVerdicts(data: SiftResult) {
  const all = [...data.traps, ...data.trusted];
  for (const r of all) {
    assert(
      r.verdict === "trap" || r.verdict === "trusted",
      `item "${r.candidate?.title ?? "?"}" has bad verdict: ${r.verdict}`,
    );
  }
  assert(
    data.traps.every((r) => r.verdict === "trap"),
    "a traps[] item is not a trap",
  );
  assert(
    data.trusted.every((r) => r.verdict === "trusted"),
    "a trusted[] item is not trusted",
  );
}

/* ------------------------------- runner -------------------------------- */

interface Row {
  name: string;
  pass: boolean;
  ms: number;
  detail: string;
}
const rows: Row[] = [];

async function test(name: string, fn: () => Promise<string>) {
  const start = performance.now();
  try {
    const detail = await fn();
    const ms = performance.now() - start;
    rows.push({ name, pass: true, ms, detail });
    console.log(`✅ PASS  ${name}  (${enc(ms)})  ${detail}`);
  } catch (err) {
    const ms = performance.now() - start;
    const detail = err instanceof Error ? err.message : String(err);
    rows.push({ name, pass: false, ms, detail });
    console.log(`❌ FAIL  ${name}  (${enc(ms)})  ${detail}`);
  }
}

/** Probe ports for a running Sift server, identified by its 400-on-empty route. */
async function resolveBase(): Promise<string> {
  if (process.env.SIFT_BASE_URL) return process.env.SIFT_BASE_URL.replace(/\/$/, "");
  const ports = [process.env.PORT, "3000", "3001", "3002"].filter(Boolean) as string[];
  for (const port of ports) {
    const base = `http://localhost:${port}`;
    try {
      const res = await fetch(`${base}/api/sift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "" }),
        signal: AbortSignal.timeout(2000),
      });
      if (res.status === 400) {
        const j = await res.json().catch(() => ({}));
        if (typeof j.error === "string") return base;
      }
    } catch {
      /* try next port */
    }
  }
  throw new Error(
    "No running Sift dev server found on 3000-3002. Start it with `npm run dev`.",
  );
}

async function main() {
  const base = await resolveBase();
  console.log(`\nSift stress test → ${base}\n${"─".repeat(60)}`);

  // Snapshot the cache so live-query writes can be reverted on exit.
  const cacheBackup = existsSync(CACHE_PATH) ? readFileSync(CACHE_PATH, "utf8") : null;

  try {
    // 1. CACHED QUERY — instant from cache.
    await test("1. cached query", async () => {
      const o = await runQuery(base, "wireless earbuds under $50");
      assert(o.error === null, `unexpected error: ${o.error}`);
      assert(o.data !== null, "no complete event / data");
      assert(o.cached === true, `expected cached=true, got ${o.cached}`);
      assert(o.data.totalChecked > 0, "totalChecked should be > 0");
      assert(o.data.traps.length > 0, "traps[] should be non-empty");
      assert(o.data.trusted.length > 0, "trusted[] should be non-empty");
      assertVerdicts(o.data);
      return `cached, ${o.data.totalChecked} checked · ${o.data.traps.length} traps · ${o.data.trusted.length} trusted`;
    });

    // 2. LIVE QUERY — full pipeline.
    await test("2. live query (keyboard)", async () => {
      const o = await runQuery(base, "mechanical keyboard under $100");
      assert(o.error === null, `error event: ${o.error}`);
      assert(o.data !== null, "no complete event / data");
      assert(o.data.totalChecked > 0, "totalChecked should be > 0");
      assertVerdicts(o.data);
      const tl = o.timeline.map((t) => `${t.stage}@${enc(t.ms)}`).join(" → ");
      return (
        `${o.cached ? "cached" : "live"}, ${o.data.totalChecked} checked · ${o.data.traps.length}/${o.data.trusted.length} trap/trusted` +
        `\n        timeline: ${tl}`
      );
    });

    // 3. LIVE QUERY — different category.
    await test("3. live query (shoes)", async () => {
      const o = await runQuery(base, "running shoes under $80");
      assert(o.error === null, `error event: ${o.error}`);
      assert(o.data !== null, "no complete event / data");
      assert(o.data.totalChecked > 0, "totalChecked should be > 0");
      assertVerdicts(o.data);
      return `${o.cached ? "cached" : "live"}, ${o.data.totalChecked} checked · ${o.data.traps.length}/${o.data.trusted.length} trap/trusted`;
    });

    // 4. EMPTY QUERY — must 400, not crash.
    await test("4. empty query", async () => {
      const o = await runQuery(base, "");
      assert(o.status === 400, `expected HTTP 400, got ${o.status}`);
      assert(o.data === null, "should not return data for empty query");
      return `400 rejected cleanly: "${o.error}"`;
    });

    // 5. VERY LONG QUERY — handle gracefully.
    await test("5. very long query (1000 chars)", async () => {
      const o = await runQuery(base, "a]".repeat(500));
      assert(o.status === 200, `expected stream (200), got ${o.status}`);
      assert(o.data !== null || o.error !== null, "no terminal event — possible hang/crash");
      const n = o.data ? o.data.totalChecked : "—";
      return `handled (${o.data ? `200, ${n} checked` : `error: ${o.error}`})`;
    });

    // 6. SPECIAL CHARACTERS — no crash, results or clean error.
    await test("6. special characters / xss", async () => {
      const o = await runQuery(base, "earbuds <script>alert('xss')</script>");
      assert(o.status === 200, `expected stream (200), got ${o.status}`);
      assert(o.data !== null || o.error !== null, "no terminal event — possible hang/crash");
      if (o.data) assertVerdicts(o.data);
      return `handled (${o.data ? `200, ${o.data.totalChecked} checked` : `error: ${o.error}`})`;
    });

    // 7. NO RESULTS — empty result, graceful.
    await test("7. no-results query", async () => {
      const o = await runQuery(base, "xyzzyplughfakequerynoonewouldever search");
      assert(o.status === 200, `expected stream (200), got ${o.status}`);
      assert(o.data !== null || o.error !== null, "no terminal event — possible hang/crash");
      if (o.data) {
        assert(o.data.totalChecked >= 0, "totalChecked should be a number");
        assertVerdicts(o.data);
      }
      return `handled (${o.data ? `${o.data.totalChecked} checked` : `error: ${o.error}`})`;
    });

    // 8. RAPID FIRE — 5 parallel cached queries.
    await test("8. rapid fire (5× parallel cached)", async () => {
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () => runQuery(base, "wireless earbuds under $50")),
      );
      outcomes.forEach((o, i) => {
        assert(o.status === 200, `req ${i + 1}: expected 200, got ${o.status}`);
        assert(o.data !== null, `req ${i + 1}: no data`);
        assert(o.data.totalChecked > 0, `req ${i + 1}: totalChecked should be > 0`);
      });
      return `all 5 → 200 with valid data`;
    });
  } finally {
    if (cacheBackup !== null) {
      writeFileSync(CACHE_PATH, cacheBackup, "utf8");
      const entries = Object.keys(JSON.parse(cacheBackup)).length;
      console.log(`\n↩  Restored cache.json to pre-test state (${entries} cached ${entries === 1 ? "entry" : "entries"}).`);
    }
  }

  // Summary.
  const passed = rows.filter((r) => r.pass).length;
  const totalMs = rows.reduce((s, r) => s + r.ms, 0);
  console.log(`${"─".repeat(60)}`);
  console.log(`SUMMARY: ${passed}/${rows.length} passed · ${enc(totalMs)} total`);
  for (const r of rows) {
    console.log(`  ${r.pass ? "✅" : "❌"} ${r.name.padEnd(38)} ${enc(r.ms).padStart(8)}`);
  }

  process.exit(passed === rows.length ? 0 : 1);
}

main().catch((err) => {
  console.error("stress test crashed:", err);
  process.exit(1);
});
