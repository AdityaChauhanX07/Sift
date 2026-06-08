/**
 * Quick helper: surface every cached candidate that points at walmart.com, so
 * we can grab a real live Walmart product URL from our actual SERP results
 * (for de-risking Nimble Extract).
 *
 * Run with: npx tsx scripts/find-walmart-urls.ts
 */
import fs from "node:fs";
import path from "node:path";
import type { SiftResult, InvestigationResult } from "../src/lib/types";

const CACHE_PATH = path.join(process.cwd(), "src", "data", "cache.json");

function matchesWalmart(r: InvestigationResult): boolean {
  const { merchant, sourceUrl } = r.candidate;
  const haystack = `${merchant ?? ""} ${sourceUrl ?? ""}`.toLowerCase();
  return haystack.includes("walmart.com") || haystack.includes("walmart");
}

function main() {
  const store: Record<string, SiftResult> = JSON.parse(
    fs.readFileSync(CACHE_PATH, "utf8"),
  );

  for (const [query, result] of Object.entries(store)) {
    const all = [...result.trusted, ...result.traps];
    const walmart = all.filter(matchesWalmart);

    console.log(`\n=== "${query}" — ${walmart.length} Walmart candidate(s) of ${all.length} ===`);

    if (walmart.length === 0) {
      console.log("  (none)");
      continue;
    }

    walmart.forEach((r, i) => {
      const c = r.candidate;
      // nimbleRaw may carry extra link fields the normalized candidate dropped.
      const raw = (c.nimbleRaw ?? {}) as Record<string, unknown>;
      console.log(`\n  [${i}] ${c.title}`);
      console.log(`      verdict:   ${r.verdict}`);
      console.log(`      merchant:  ${c.merchant || "—"}`);
      console.log(`      sourceUrl: ${c.sourceUrl || "—"}`);
      console.log(`      raw.item_link: ${raw.item_link ?? "—"}`);
      console.log(`      raw.url:       ${raw.url ?? "—"}`);
    });
  }
}

main();
