/**
 * Pre-compute and cache all five landing-page suggestion queries.
 *
 * Runs the full live investigation once per query (SEQUENTIALLY, to avoid
 * Nimble/Groq rate limits) and writes each result to src/data/cache.json via the
 * cache module. The golden query is skipped if it's already cached so we don't
 * re-spend credits / overwrite the curated golden result.
 *
 * Run with: npm run cache:all
 */
import { config } from "dotenv";

// Load NIMBLE_* / GROQ_API_KEY from .env.local before importing anything that
// reads them at construction time.
config({ path: ".env.local" });

import type { SiftResult } from "../src/lib/types";

/** The five queries offered as chips on the landing command line. */
const QUERIES = [
  "wireless earbuds under $50",
  "mechanical keyboard hot-swap",
  "portable ssd 2tb",
  "espresso machine under $300",
  "running shoes neutral",
];

/** The golden query — already curated, so skip it if it's present. */
const GOLDEN_QUERY = "wireless earbuds under $50";

interface Summary {
  query: string;
  status: "cached" | "skipped" | "failed";
  total?: number;
  traps?: number;
  trusted?: number;
  enriched?: number;
  error?: string;
}

/**
 * Print every candidate that picked up verified Extract data during the run.
 * investigate() runs attachEnrichment internally, so enriched candidates show up
 * on the returned result's traps/trusted lists via candidate.enrichment.
 * Returns how many were enriched so the summary can report it.
 */
function reportEnrichment(label: string, result: SiftResult): number {
  const enriched = [...result.traps, ...result.trusted].filter(
    (r) => r.candidate.enrichment,
  );

  if (enriched.length === 0) {
    console.log(`${label} — no candidates got enrichment data`);
    return 0;
  }

  console.log(`${label} — ${enriched.length} candidate(s) enriched:`);
  for (const r of enriched) {
    const e = r.candidate.enrichment!;
    const price = e.realPrice ?? "?";
    const was = e.wasPrice ? ` (was ${e.wasPrice})` : "";
    const rating =
      e.averageRating !== null
        ? `${e.averageRating}/5 from ${e.totalReviews ?? "?"} reviews`
        : "no rating";
    console.log(`    • [${r.verdict}] ${r.candidate.title}`);
    console.log(
      `        ${price}${was} · ${rating} · seller ${e.sellerName ?? "?"}`,
    );
  }
  return enriched.length;
}

async function main() {
  // Import after env is loaded so the clients see their credentials.
  const { investigate } = await import("../src/lib/investigator");
  const { getCachedResult, setCachedResult } = await import("../src/lib/cache");

  const summaries: Summary[] = [];

  for (let i = 0; i < QUERIES.length; i++) {
    const query = QUERIES[i];
    const label = `[${i + 1}/${QUERIES.length}] "${query}"`;

    // Skip the golden query when it's already baked in.
    if (query === GOLDEN_QUERY && getCachedResult(query)) {
      console.log(`${label} — already cached, skipping.`);
      summaries.push({ query, status: "skipped" });
      continue;
    }

    console.log(`${label} — investigating...`);
    try {
      const result = await investigate(query);
      setCachedResult(query, result);
      console.log(
        `${label} — cached · total ${result.totalChecked} · traps ${result.traps.length} · trusted ${result.trusted.length}`,
      );
      // investigate() ran attachSourceMatches + attachEnrichment internally;
      // show which candidates actually came back with verified Extract data.
      const enriched = reportEnrichment(label, result);
      summaries.push({
        query,
        status: "cached",
        total: result.totalChecked,
        traps: result.traps.length,
        trusted: result.trusted.length,
        enriched,
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`${label} — FAILED: ${error}`);
      summaries.push({ query, status: "failed", error });
    }
  }

  // Summary table.
  console.log(`\n${"─".repeat(60)}`);
  console.log("SUMMARY");
  for (const s of summaries) {
    if (s.status === "cached") {
      console.log(
        `  ✅ ${s.query.padEnd(34)} total ${s.total} · ${s.traps} traps · ${s.trusted} trusted · ${s.enriched} enriched`,
      );
    } else if (s.status === "skipped") {
      console.log(`  ⏭  ${s.query.padEnd(34)} already cached (skipped)`);
    } else {
      console.log(`  ❌ ${s.query.padEnd(34)} ${s.error}`);
    }
  }

  const failed = summaries.filter((s) => s.status === "failed").length;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Failed to cache queries:", err);
  process.exit(1);
});
