/**
 * Deep stress test for Sift's /api/sift pipeline — 17 scenarios.
 *
 * Covers flow (cached + live), edge cases, data integrity, streaming integrity,
 * and concurrency. Prints PASS/FAIL + timing per test and a summary.
 *
 * Prereq: the dev server must already be running (auto-detected on 3000-3002, or
 * set SIFT_BASE_URL / PORT).
 *
 * SIDE EFFECT: live queries make the route write into src/data/cache.json. This
 * script snapshots that file up front and RESTORES it on exit, so the golden
 * cache isn't polluted and repeated runs stay live.
 *
 * Run with: npm run test:deep  (after `npm run dev`)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SiftResult } from "../src/lib/types";

const CACHE_PATH = join(process.cwd(), "src", "data", "cache.json");
const enc = (n: number) => `${n.toFixed(0)}ms`;

/** Outcome of one streaming call. */
interface Outcome {
  status: number;
  cached: boolean | null;
  data: SiftResult | null;
  error: string | null;
  progressEvents: number;
  /** Ordered stage names exactly as seen (with repeats). */
  order: string[];
  /** Number of terminal "complete" events seen. */
  completeCount: number;
  /** Lines that failed JSON.parse. */
  invalidLines: number;
  /** Total non-blank NDJSON lines. */
  totalLines: number;
}

/** POST a query and consume the NDJSON stream to a terminal outcome. */
async function runQuery(
  base: string,
  query: string,
  timeoutMs = 90_000,
): Promise<Outcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const order: string[] = [];

  try {
    const res = await fetch(`${base}/api/sift`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    // Validation errors come back as plain JSON, not a stream.
    if (!res.ok || !res.body) {
      let error = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        error = j.error ?? j.detail ?? error;
      } catch {
        /* leave default */
      }
      return {
        status: res.status, cached: null, data: null, error,
        progressEvents: 0, order, completeCount: 0, invalidLines: 0, totalLines: 0,
      };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let data: SiftResult | null = null;
    let cached: boolean | null = null;
    let error: string | null = null;
    let progressEvents = 0;
    let completeCount = 0;
    let invalidLines = 0;
    let totalLines = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        totalLines++;
        let e: { stage?: string; data?: SiftResult; cached?: boolean; message?: string };
        try {
          e = JSON.parse(line);
        } catch {
          invalidLines++;
          continue;
        }
        order.push(e.stage ?? "(no-stage)");
        if (e.stage === "complete") {
          completeCount++;
          data = e.data ?? null;
          cached = e.cached ?? null;
        } else if (e.stage === "error") {
          error = e.message ?? "error event";
        } else {
          progressEvents++;
        }
      }
    }

    return {
      status: res.status, cached, data, error,
      progressEvents, order, completeCount, invalidLines, totalLines,
    };
  } catch (err) {
    return {
      status: 0, cached: null, data: null,
      error: err instanceof Error ? err.message : String(err),
      progressEvents: 0, order, completeCount: 0, invalidLines: 0, totalLines: 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------ assertions ------------------------------ */

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const isStr = (v: unknown): v is string => typeof v === "string";
const nonEmptyStr = (v: unknown): v is string => isStr(v) && v.trim().length > 0;

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

const GOLDEN = "wireless earbuds under $50";

async function main() {
  const base = await resolveBase();
  console.log(`\nSift DEEP test → ${base}\n${"─".repeat(64)}`);

  const cacheBackup = existsSync(CACHE_PATH) ? readFileSync(CACHE_PATH, "utf8") : null;

  // Cross-test state.
  let liveQ2Ms = Infinity;
  const liveQ2 = "bluetooth speaker under $30";
  const liveQ3 = "usb-c hub dock";
  let golden: SiftResult | null = null;

  try {
    /* ===================== FLOW TESTS ===================== */

    // 1. GOLDEN QUERY (cached path)
    await test("1. golden query (cached)", async () => {
      const o = await runQuery(base, GOLDEN);
      assert(o.status === 200, `expected 200, got ${o.status}`);
      assert(o.error === null, `unexpected error: ${o.error}`);
      assert(o.data !== null, "no complete event / data");
      assert(o.cached === true, `expected cached=true, got ${o.cached}`);
      assert(o.data.totalChecked > 0, "totalChecked should be > 0");
      assert(o.data.traps.length > 0, "traps[] should be non-empty");
      assert(o.data.trusted.length > 0, "trusted[] should be non-empty");
      const enriched = o.data.trusted.filter((r) => r.candidate.enrichment).length;
      const sourced = o.data.traps.filter((r) => r.candidate.sourceMatch).length;
      assert(enriched >= 1, "expected >=1 trusted item with enrichment");
      assert(sourced >= 1, "expected >=1 trap item with sourceMatch");
      return `cached, ${o.data.totalChecked} checked · ${o.data.traps.length} traps · ${o.data.trusted.length} trusted · ${enriched} enriched · ${sourced} sourced`;
    });

    // 2. LIVE QUERY (uncached) — full pipeline, < 30s.
    await test("2. live query (speaker)", async () => {
      const start = performance.now();
      const o = await runQuery(base, liveQ2);
      liveQ2Ms = performance.now() - start;
      assert(o.status === 200, `expected 200, got ${o.status}`);
      assert(o.error === null, `error event: ${o.error}`);
      assert(o.data !== null, "no complete event / data");
      assert(o.data.totalChecked > 0, "totalChecked should be > 0");
      // pipeline stages should appear (some may be absent if nothing suspicious)
      const stages = new Set(o.order);
      assert(stages.has("searching"), "missing 'searching' stage");
      assert(stages.has("found"), "missing 'found' stage");
      assert(stages.has("investigating"), "missing 'investigating' stage");
      assert(liveQ2Ms < 30_000, `took ${enc(liveQ2Ms)} (>30s)`);
      const seen = Array.from(stages).join(",");
      return `${o.cached ? "CACHED?!" : "live"} ${enc(liveQ2Ms)}, ${o.data.totalChecked} checked · ${o.data.traps.length}/${o.data.trusted.length} · stages: ${seen}`;
    });

    // 3. SECOND LIVE QUERY (different category) — different results from #2.
    await test("3. live query (usb-c hub)", async () => {
      const o = await runQuery(base, liveQ3);
      assert(o.status === 200, `expected 200, got ${o.status}`);
      assert(o.error === null, `error event: ${o.error}`);
      assert(o.data !== null, "no complete event / data");
      assert(o.data.totalChecked > 0, "totalChecked should be > 0");
      return `${o.cached ? "cached" : "live"}, ${o.data.totalChecked} checked · ${o.data.traps.length}/${o.data.trusted.length}`;
    });

    // 4. CACHED AFTER LIVE — re-run #2, now cached + faster.
    await test("4. cached after live (re-run #2)", async () => {
      const start = performance.now();
      const o = await runQuery(base, liveQ2);
      const ms = performance.now() - start;
      assert(o.status === 200, `expected 200, got ${o.status}`);
      assert(o.data !== null, "no complete event / data");
      assert(o.cached === true, `expected cached=true, got ${o.cached}`);
      assert(ms < liveQ2Ms, `not faster: ${enc(ms)} vs live ${enc(liveQ2Ms)}`);
      return `cached=true, ${enc(ms)} (live was ${enc(liveQ2Ms)})`;
    });

    /* ===================== EDGE CASES ===================== */

    // 5. EMPTY QUERY → 400.
    await test("5. empty query → 400", async () => {
      const o = await runQuery(base, "");
      assert(o.status === 400, `expected 400, got ${o.status}`);
      assert(o.data === null, "should not return data");
      assert(o.totalLines === 0, "should not stream NDJSON");
      return `400: "${o.error}"`;
    });

    // 6. MISSING BODY → 400 (raw fetch, no body).
    await test("6. missing body → 400", async () => {
      const res = await fetch(`${base}/api/sift`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      assert(res.status === 400, `expected 400, got ${res.status}`);
      const j = await res.json().catch(() => ({}));
      return `400: "${j.error ?? "(no error field)"}"`;
    });

    // 7. WRONG METHOD (GET) → 405 (raw fetch).
    await test("7. GET method → 405", async () => {
      const res = await fetch(`${base}/api/sift`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      await res.text().catch(() => "");
      assert(
        res.status === 405 || res.status === 404 || res.status === 400,
        `expected 4xx (405), got ${res.status}`,
      );
      assert(res.status < 500, `server error on GET: ${res.status}`);
      return `HTTP ${res.status} (allow: ${res.headers.get("allow") ?? "—"})`;
    });

    // 8. VERY LONG QUERY (~2000 chars) — handle gracefully.
    await test("8. very long query (2000 chars)", async () => {
      const o = await runQuery(base, "a]".repeat(1000));
      assert(o.status === 200, `expected 200, got ${o.status}`);
      assert(o.data !== null || o.error !== null, "no terminal event — hang/crash");
      assert(o.completeCount <= 1, `duplicate complete events: ${o.completeCount}`);
      return `handled (${o.data ? `${o.data.totalChecked} checked` : `error: ${o.error}`})`;
    });

    // 9. SPECIAL CHARS / XSS — no crash.
    await test("9. special chars / xss", async () => {
      const o = await runQuery(base, "<script>alert(1)</script>");
      assert(o.status === 200, `expected 200, got ${o.status}`);
      assert(o.data !== null || o.error !== null, "no terminal event — hang/crash");
      return `handled (${o.data ? `${o.data.totalChecked} checked` : `error: ${o.error}`})`;
    });

    // 10. UNICODE — handle gracefully (may be 0 results).
    await test("10. unicode query", async () => {
      const o = await runQuery(base, "블루투스 이어폰");
      assert(o.status === 200, `expected 200, got ${o.status}`);
      assert(o.data !== null || o.error !== null, "no terminal event — hang/crash");
      return `handled (${o.data ? `${o.data.totalChecked} checked` : `error: ${o.error}`})`;
    });

    /* ===================== DATA INTEGRITY ===================== */

    // Fetch the golden result once for the integrity checks.
    golden = (await runQuery(base, GOLDEN)).data;

    // 11. Trusted items shape.
    await test("11. trusted items integrity", async () => {
      assert(golden !== null, "golden data unavailable");
      const bad: string[] = [];
      golden.trusted.forEach((r, i) => {
        const c = r.candidate;
        if (typeof r.trustScore !== "number" || r.trustScore < 0 || r.trustScore > 100)
          bad.push(`#${i} trustScore=${r.trustScore}`);
        if (r.verdict !== "trusted") bad.push(`#${i} verdict=${r.verdict}`);
        if (!Array.isArray(r.flags)) bad.push(`#${i} flags not array`);
        if (!Array.isArray(r.evidence) || r.evidence.length === 0)
          bad.push(`#${i} evidence empty`);
        if (!nonEmptyStr(c.title)) bad.push(`#${i} title empty`);
        if (!nonEmptyStr(c.price)) bad.push(`#${i} price empty ("${c.price}")`);
        if (!nonEmptyStr(c.merchant)) bad.push(`#${i} merchant empty ("${c.merchant}")`);
      });
      assert(bad.length === 0, `${bad.length} issue(s): ${bad.slice(0, 6).join("; ")}`);
      return `${golden.trusted.length} trusted items all valid`;
    });

    // 12. Trap items shape.
    await test("12. trap items integrity", async () => {
      assert(golden !== null, "golden data unavailable");
      const bad: string[] = [];
      golden.traps.forEach((r, i) => {
        const c = r.candidate;
        if (r.verdict !== "trap") bad.push(`#${i} verdict=${r.verdict}`);
        if (!Array.isArray(r.flags) || r.flags.length === 0)
          bad.push(`#${i} flags empty`);
        if (!nonEmptyStr(c.title)) bad.push(`#${i} title empty`);
        if (!nonEmptyStr(c.merchant)) bad.push(`#${i} merchant empty ("${c.merchant}")`);
      });
      assert(bad.length === 0, `${bad.length} issue(s): ${bad.slice(0, 6).join("; ")}`);
      return `${golden.traps.length} trap items all valid`;
    });

    // 13. Enriched items shape.
    await test("13. enriched items integrity", async () => {
      assert(golden !== null, "golden data unavailable");
      const all = [...golden.trusted, ...golden.traps].filter((r) => r.candidate.enrichment);
      assert(all.length > 0, "no enriched items found");
      const bad: string[] = [];
      all.forEach((r, i) => {
        const e = r.candidate.enrichment!;
        if (!isStr(e.realPrice) || !e.realPrice.startsWith("$"))
          bad.push(`#${i} realPrice="${e.realPrice}"`);
        if (typeof e.averageRating !== "number")
          bad.push(`#${i} averageRating=${e.averageRating}`);
        if (typeof e.totalReviews !== "number" || e.totalReviews <= 0)
          bad.push(`#${i} totalReviews=${e.totalReviews}`);
      });
      assert(bad.length === 0, `${bad.length} issue(s): ${bad.slice(0, 6).join("; ")}`);
      return `${all.length} enriched items all valid`;
    });

    // 14. Source-match items shape.
    await test("14. source-match integrity", async () => {
      assert(golden !== null, "golden data unavailable");
      const all = [...golden.traps, ...golden.trusted].filter((r) => r.candidate.sourceMatch);
      assert(all.length > 0, "no source-match items found");
      const bad: string[] = [];
      all.forEach((r, i) => {
        const s = r.candidate.sourceMatch!;
        if (!isStr(s.aliExpressUrl) || !s.aliExpressUrl.includes("aliexpress.com"))
          bad.push(`#${i} url="${s.aliExpressUrl}"`);
        if (!nonEmptyStr(s.aliExpressTitle)) bad.push(`#${i} title empty`);
        if (!(s.markup === null || (typeof s.markup === "number" && s.markup > 0)))
          bad.push(`#${i} markup=${s.markup}`);
      });
      assert(bad.length === 0, `${bad.length} issue(s): ${bad.slice(0, 6).join("; ")}`);
      return `${all.length} source-match items all valid`;
    });

    /* ===================== STREAMING INTEGRITY ===================== */

    // 15. NDJSON stream structure for the golden query.
    await test("15. streaming integrity (golden)", async () => {
      const o = await runQuery(base, GOLDEN);
      assert(o.invalidLines === 0, `${o.invalidLines} invalid JSON line(s)`);
      assert(o.totalLines > 0, "no lines streamed");
      assert(o.order[0] === "searching", `first stage is "${o.order[0]}", expected "searching"`);
      assert(
        o.order[o.order.length - 1] === "complete",
        `last stage is "${o.order[o.order.length - 1]}", expected "complete"`,
      );
      assert(o.completeCount === 1, `expected exactly 1 complete, got ${o.completeCount}`);
      assert(o.data !== null, "complete event missing data");
      assert(Array.isArray(o.data.traps) && Array.isArray(o.data.trusted), "data shape invalid");
      return `${o.totalLines} lines, valid JSON, searching→…→complete (1×)`;
    });

    /* ===================== CONCURRENCY ===================== */

    // 16. 5 parallel golden requests.
    await test("16. 5× parallel golden", async () => {
      const outs = await Promise.all(Array.from({ length: 5 }, () => runQuery(base, GOLDEN)));
      outs.forEach((o, i) => {
        assert(o.status === 200, `req ${i + 1}: status ${o.status}`);
        assert(o.data !== null, `req ${i + 1}: no data`);
        assert(o.data.totalChecked > 0, `req ${i + 1}: totalChecked=0`);
        assert(o.completeCount === 1, `req ${i + 1}: completeCount=${o.completeCount}`);
      });
      return `all 5 → 200 with valid data`;
    });

    // 17. 3 different queries in parallel.
    await test("17. 3× parallel different queries", async () => {
      const queries = [GOLDEN, liveQ2, liveQ3];
      const outs = await Promise.all(queries.map((q) => runQuery(base, q)));
      outs.forEach((o, i) => {
        assert(o.status === 200, `"${queries[i]}": status ${o.status}`);
        assert(o.error === null, `"${queries[i]}": error ${o.error}`);
        assert(o.data !== null, `"${queries[i]}": no data`);
      });
      const sizes = outs.map((o, i) => `${queries[i].slice(0, 14)}=${o.data!.totalChecked}`).join(", ");
      return `all 3 ok (${sizes})`;
    });
  } finally {
    if (cacheBackup !== null) {
      writeFileSync(CACHE_PATH, cacheBackup, "utf8");
      const entries = Object.keys(JSON.parse(cacheBackup)).length;
      console.log(
        `\n↩  Restored cache.json to pre-test state (${entries} cached ${entries === 1 ? "entry" : "entries"}).`,
      );
    }
  }

  // Summary.
  const passed = rows.filter((r) => r.pass).length;
  const totalMs = rows.reduce((s, r) => s + r.ms, 0);
  console.log(`${"─".repeat(64)}`);
  console.log(`SUMMARY: ${passed}/${rows.length} passed · ${enc(totalMs)} total`);
  for (const r of rows) {
    console.log(`  ${r.pass ? "✅" : "❌"} ${r.name.padEnd(36)} ${enc(r.ms).padStart(9)}`);
  }
  const fails = rows.filter((r) => !r.pass);
  if (fails.length > 0) {
    console.log(`\nFAILURES (${fails.length}):`);
    for (const r of fails) console.log(`  ❌ ${r.name}: ${r.detail}`);
  }

  process.exit(passed === rows.length ? 0 : 1);
}

main().catch((err) => {
  console.error("deep test crashed:", err);
  process.exit(1);
});
