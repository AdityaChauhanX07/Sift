/**
 * Manually enrich the golden query with real Nimble Extract data.
 *
 * Pipeline: search → build candidates → for a hand-picked set of products, pull
 * the live product page via Extract and attach verified data → re-run the Groq
 * investigation with the enriched candidates → overwrite the golden cache.
 *
 * This guarantees the demo shows real, citable evidence (true price, seller,
 * review counts) for at least the mapped candidates.
 *
 * Run with: npm run enrich:golden
 */
import { config } from "dotenv";

// Load NIMBLE_* / GROQ_API_KEY before importing modules that construct clients.
config({ path: ".env.local" });

import type { DealCandidate, SiftResult } from "../src/lib/types";

const GOLDEN_QUERY = "wireless earbuds under $50";

// Hand-verified product pages (see scripts/test-extract.ts de-risk).
const URL_BY_TITLE: Record<string, string> = {
  "JLab Go Air Pop True Wireless Earbuds":
    "https://www.walmart.com/ip/JLab-Go-Air-Pop-True-Wireless-Earbuds-w-Charging-Case-Black/631193073",
  "Skullcandy Smokin' Buds XT True Wireless in-Ear Earbuds":
    "https://www.walmart.com/ip/Skullcandy-Smokin-Buds-XT-True-Wireless-in-Ear-Earbuds-Black/1546280223",
};

/** Generic words that don't distinguish one earbud listing from another. */
const STOPWORDS = new Set([
  "true", "wireless", "earbuds", "earbud", "earphones", "earphone", "headphones",
  "in", "ear", "bluetooth", "with", "w", "charging", "case", "black", "white",
  "and", "the", "for", "stereo", "bass", "sports", "mini", "mic", "noise",
  "cancelling", "canceling",
]);

/** Normalize a title to lowercase alphanumeric tokens. */
function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/** The distinctive (non-generic) tokens of a title — brand + model words. */
function distinctiveTokens(s: string): string[] {
  return tokens(s).filter((t) => !STOPWORDS.has(t));
}

/**
 * A candidate matches a mapped product only if it contains ALL the distinctive
 * (brand + model) tokens of the mapped title. Strict on purpose: a generic
 * "Wireless Earbuds" listing must NOT absorb a specific product's verified data,
 * and a different model (e.g. "Go Pods ANC" vs "Go Air Pop") must not match —
 * in those cases we inject the mapped product as its own candidate instead.
 */
function titlesMatch(candidateTitle: string, mappedTitle: string): boolean {
  const needed = distinctiveTokens(mappedTitle);
  if (needed.length === 0) return false;
  const have = tokens(candidateTitle);
  return needed.every((t) => have.includes(t));
}

async function main() {
  // Import after env is loaded so clients see their credentials.
  const { NimbleClient, toDealCandidate } = await import("../src/lib/nimble");
  const { GroqInvestigator } = await import("../src/lib/groq");
  const { dedupeByTitle, attachSourceMatches } = await import(
    "../src/lib/investigator"
  );
  const { setCachedResult } = await import("../src/lib/cache");

  const nimble = new NimbleClient();

  console.log(`Searching: "${GOLDEN_QUERY}"...`);
  const { shopping, organic } = await nimble.searchDeals(GOLDEN_QUERY);
  const candidates: DealCandidate[] = dedupeByTitle(shopping.map(toDealCandidate));
  console.log(`  ${candidates.length} candidates, ${organic.length} organic results.`);

  let enriched = 0;
  for (const [title, url] of Object.entries(URL_BY_TITLE)) {
    console.log(`\nEnriching "${title}"`);
    console.log(`  ${url}`);

    const raw = await nimble.extractProductPage(url);
    if (!raw) {
      console.warn("  ✗ extract returned null — skipping");
      continue;
    }

    const data = nimble.parseExtractedProduct(raw);
    if (!data) {
      console.warn("  ✗ parse returned null — skipping");
      continue;
    }
    console.log(
      `  ✓ ${data.realPrice}${data.wasPrice ? ` (was ${data.wasPrice})` : ""} · ` +
        `${data.averageRating}/5 from ${data.totalReviews} reviews · ` +
        `${data.recommendedPercent}% recommended · seller ${data.sellerName}`,
    );

    const match = candidates.find((c) => titlesMatch(c.title, title));
    if (match) {
      match.enrichment = data;
      console.log(`  → attached to candidate "${match.title}"`);
    } else {
      // No live candidate matched (SERP drifts) — inject one so the demo still
      // carries this verified evidence.
      candidates.push({
        title,
        price: data.realPrice ?? "",
        oldPrice: data.wasPrice,
        merchant: data.sellerName ?? "Walmart",
        thumbnailUrl: null,
        isOnSale: data.isPriceReduced,
        sourceUrl: url,
        enrichment: data,
        nimbleRaw: null,
      });
      console.log("  → no matching candidate; injected a synthetic one");
    }
    enriched++;
  }

  // Same AliExpress source-lookup step the live pipeline runs, so the cached
  // golden result carries real dropship/markup evidence too.
  console.log("\nRunning AliExpress source lookup on suspicious candidates...");
  await attachSourceMatches(nimble, candidates);
  const matched = candidates.filter((c) => c.sourceMatch);
  console.log(`  ${matched.length} candidate(s) matched to an AliExpress source.`);
  for (const c of matched) {
    const s = c.sourceMatch!;
    const priceStr =
      s.aliExpressPrice !== null
        ? `$${s.aliExpressPrice.toFixed(2)}${s.markup !== null ? ` (${s.markup}x)` : ""}`
        : "no price";
    console.log(`    • ${c.title}\n        → ${priceStr} — ${s.aliExpressUrl}`);
  }

  console.log(`\nEnriched ${enriched} candidate(s). Re-running Groq investigation...`);
  const groq = new GroqInvestigator();
  const results = await groq.investigateDeals(candidates, organic);

  const traps = results.filter((r) => r.verdict === "trap");
  const trusted = results.filter((r) => r.verdict === "trusted");
  const result: SiftResult = {
    query: GOLDEN_QUERY,
    totalChecked: results.length,
    traps,
    trusted,
  };

  setCachedResult(GOLDEN_QUERY, result);

  console.log("\nCached enriched result to src/data/cache.json:");
  console.log(`  total: ${result.totalChecked} · traps: ${traps.length} · trusted: ${trusted.length}`);
  console.log("\nEnriched candidates' verdicts:");
  for (const r of results) {
    if (!r.candidate.enrichment) continue;
    console.log(`  [${r.verdict}] ${r.candidate.title} — score ${r.trustScore}`);
    r.evidence.forEach((e) => console.log(`      • ${e}`));
  }
}

main().catch((err) => {
  console.error("enrich:golden failed:", err);
  process.exit(1);
});
