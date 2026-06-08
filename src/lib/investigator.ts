/**
 * Investigation orchestration for Sift.
 *
 * Ties the Nimble search and the Groq investigator together: query -> candidates
 * -> verdicts -> a single SiftResult split into traps vs. trusted.
 */
import { NimbleClient, toDealCandidate } from "./nimble";
import type { AliExpressResult } from "./nimble";
import { GroqInvestigator } from "./groq";
import type { DealCandidate, ProgressFn, SiftResult } from "./types";

/** No-op progress sink, so callers can omit onProgress. */
const NOOP: ProgressFn = () => {};

/** Parse a price string into a comparable number; missing/unparseable sorts last. */
function priceValue(value: string): number {
  const match = value.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : Number.POSITIVE_INFINITY;
}

/** Parse a price string into a number, or null when it has no parseable figure. */
function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

/** Max suspicious candidates we'll run an AliExpress lookup for — caps spend. */
const MAX_SOURCE_LOOKUPS = 5;

/** Max product-page Extracts we'll run per query — caps spend. */
const MAX_EXTRACTS = 3;

/**
 * Retailers we enrich live — those whose Extract shape parseExtractedProduct can
 * read (Walmart's proprietary shape, Best Buy's schema.org shape). Target still
 * returns no usable entities, so it's left out. The MAX_EXTRACTS cap applies
 * across all of these combined.
 */
const EXTRACTABLE_RETAILER = /walmart|best ?buy/i;

/** A clean display name for a retailer string, for progress messages. */
function prettyRetailer(merchant: string): string {
  if (/walmart/i.test(merchant)) return "Walmart";
  if (/best ?buy/i.test(merchant)) return "Best Buy";
  if (/target/i.test(merchant)) return "Target";
  return merchant.trim() || "the retailer";
}

/** Retailers whose own listings we trust enough to skip a source lookup. */
const KNOWN_RETAILER =
  /amazon|walmart|best ?buy|target|costco|jlab|skullcandy|soundcore|anker|samsung|sony|bose|apple/i;

/**
 * A candidate worth checking against AliExpress: rock-bottom price, an unknown
 * merchant, or a long keyword-stuffed title — the classic dropship tells.
 */
function isSuspicious(candidate: DealCandidate): boolean {
  const price = parsePrice(candidate.price);
  const cheap = price !== null && price < 15;
  const unknownMerchant =
    candidate.merchant.trim() !== "" && !KNOWN_RETAILER.test(candidate.merchant);
  const stuffedTitle = candidate.title.length > 80;
  return cheap || unknownMerchant || stuffedTitle;
}

/**
 * Pick the best AliExpress source listing for markup math: the cheapest one with
 * a parseable price (clearest markup story), or the first result if none carry a
 * price. Returns null when the list is empty.
 */
function bestSourceMatch(results: AliExpressResult[]): AliExpressResult | null {
  if (results.length === 0) return null;
  const priced = results.filter((r) => parsePrice(r.price) !== null);
  if (priced.length === 0) return results[0];
  return priced.reduce((cheapest, r) =>
    parsePrice(r.price)! < parsePrice(cheapest.price)! ? r : cheapest,
  );
}

/**
 * For up to MAX_SOURCE_LOOKUPS suspicious candidates, find the AliExpress source
 * listing and attach it as evidence. Mutates the candidates in place. Runs the
 * lookups in parallel and never throws — searchAliExpress already degrades to [].
 *
 * A match is attached even when no price could be scraped from the snippet: the
 * title + URL match alone is evidence of dropshipping. `markup` stays null in
 * that case (we can't compute it without the source price).
 */
export async function attachSourceMatches(
  nimble: NimbleClient,
  candidates: DealCandidate[],
  onProgress: ProgressFn = NOOP,
): Promise<void> {
  const suspects = candidates.filter(isSuspicious).slice(0, MAX_SOURCE_LOOKUPS);
  const total = suspects.length;
  if (total === 0) return;

  onProgress({
    stage: "source_lookup",
    message: "Checking AliExpress for source matches...",
    current: 0,
    total,
  });

  let done = 0;
  await Promise.all(
    suspects.map(async (candidate) => {
      const results = await nimble.searchAliExpress(candidate.title);
      const match = bestSourceMatch(results);
      done++;

      if (!match) {
        onProgress({
          stage: "source_lookup",
          message: `Checked ${done} of ${total} on AliExpress`,
          current: done,
          total,
        });
        return;
      }

      const aliExpressPrice = parsePrice(match.price);
      const candidatePrice = parsePrice(candidate.price);
      const markup =
        candidatePrice !== null && aliExpressPrice !== null && aliExpressPrice > 0
          ? Math.round((candidatePrice / aliExpressPrice) * 10) / 10
          : null;

      candidate.sourceMatch = {
        aliExpressTitle: match.title,
        aliExpressPrice,
        aliExpressUrl: match.url,
        markup,
      };

      const detail =
        markup !== null
          ? `same product on AliExpress — ${markup}x markup`
          : "same product on AliExpress";
      onProgress({
        stage: "source_lookup",
        message: `Found match: ${detail}`,
        current: done,
        total,
      });
    }),
  );
}

/**
 * For up to MAX_EXTRACTS candidates from extractable retailers (Walmart, Best
 * Buy, Target) that aren't already enriched, find the product-page URL and pull
 * real on-page data (price, seller, reviews) via Nimble Extract. Mutates the
 * candidates in place. Runs in parallel and never throws — find/extract already
 * degrade to null. This is what gives LIVE queries verified data, not just the
 * cached golden query.
 */
export async function attachEnrichment(
  nimble: NimbleClient,
  candidates: DealCandidate[],
  onProgress: ProgressFn = NOOP,
): Promise<void> {
  const targets = candidates
    .filter((c) => !c.enrichment && EXTRACTABLE_RETAILER.test(c.merchant))
    .slice(0, MAX_EXTRACTS);
  const total = targets.length;
  if (total === 0) return;

  onProgress({
    stage: "enriching",
    message: "Extracting verified data from product pages...",
    current: 0,
    total,
  });

  let done = 0;
  await Promise.all(
    targets.map(async (candidate) => {
      const url = await nimble.findProductUrl(candidate.title, candidate.merchant);
      if (url) {
        const raw = await nimble.extractProductPage(url);
        const data = raw ? nimble.parseExtractedProduct(raw) : null;
        if (data) {
          candidate.enrichment = data;
          // Promote the URL we found if the candidate had none.
          candidate.sourceUrl = candidate.sourceUrl ?? url;
        }
      }
      done++;
      onProgress({
        stage: "enriching",
        message: `Extracting verified data from ${prettyRetailer(candidate.merchant)}...`,
        current: done,
        total,
      });
    }),
  );
}

/**
 * Collapse duplicate listings (same title, case-insensitive) down to a single
 * candidate — the one with the lowest parseable price. Prevents the same
 * product surfacing as multiple trusted results.
 */
export function dedupeByTitle(candidates: DealCandidate[]): DealCandidate[] {
  const byTitle = new Map<string, DealCandidate>();
  for (const candidate of candidates) {
    const key = candidate.title.trim().toLowerCase();
    const existing = byTitle.get(key);
    if (!existing || priceValue(candidate.price) < priceValue(existing.price)) {
      byTitle.set(key, candidate);
    }
  }
  return Array.from(byTitle.values());
}

/**
 * Run the full pipeline for a query and return a partitioned SiftResult.
 * Reports each real step through `onProgress` so the client can show a live
 * investigation feed. Throws if Nimble or Groq fail; the API route turns that
 * into a streamed error event.
 */
export async function investigate(
  query: string,
  onProgress: ProgressFn = NOOP,
): Promise<SiftResult> {
  const nimble = new NimbleClient();

  onProgress({ stage: "searching", message: "Searching the web for deals..." });
  const { shopping, organic } = await nimble.searchDeals(query);

  // Only shopping results are candidates. Organic results are passed to Groq
  // as supporting context (e.g. review-site recommendations), not investigated.
  const candidates: DealCandidate[] = dedupeByTitle(shopping.map(toDealCandidate));

  onProgress({
    stage: "found",
    message: `Found ${candidates.length} candidates`,
    count: candidates.length,
  });

  // Nothing to investigate — return an empty-but-valid result.
  if (candidates.length === 0) {
    return { query, totalChecked: 0, traps: [], trusted: [] };
  }

  // Hunt the AliExpress source for suspicious candidates so Groq can cite real
  // dropship markup. Best-effort; a failed lookup just leaves sourceMatch unset.
  await attachSourceMatches(nimble, candidates, onProgress);

  // Pull real verified data from a few known-retailer product pages so live
  // queries get the same trusted-card treatment as the cached golden query.
  await attachEnrichment(nimble, candidates, onProgress);

  onProgress({
    stage: "investigating",
    message: "Analyzing with AI — classifying each deal...",
  });
  const groq = new GroqInvestigator();
  const results = await groq.investigateDeals(candidates, organic);

  const traps = results.filter((r) => r.verdict === "trap");
  const trusted = results.filter((r) => r.verdict === "trusted");

  return {
    query,
    totalChecked: results.length,
    traps,
    trusted,
  };
}
