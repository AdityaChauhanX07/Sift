/**
 * Investigation orchestration for Sift.
 *
 * Ties the Nimble search and the Groq investigator together: query -> candidates
 * -> verdicts -> a single SiftResult split into traps vs. trusted.
 */
import { NimbleClient, toDealCandidate } from "./nimble";
import { GroqInvestigator } from "./groq";
import type { DealCandidate, SiftResult } from "./types";

/** Parse a price string into a comparable number; missing/unparseable sorts last. */
function priceValue(value: string): number {
  const match = value.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : Number.POSITIVE_INFINITY;
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
 * Throws if Nimble or Groq fail; the API route turns that into an HTTP error.
 */
export async function investigate(query: string): Promise<SiftResult> {
  const nimble = new NimbleClient();
  const { shopping, organic } = await nimble.searchDeals(query);

  // Only shopping results are candidates. Organic results are passed to Groq
  // as supporting context (e.g. review-site recommendations), not investigated.
  const candidates: DealCandidate[] = dedupeByTitle(shopping.map(toDealCandidate));

  // Nothing to investigate — return an empty-but-valid result.
  if (candidates.length === 0) {
    return { query, totalChecked: 0, traps: [], trusted: [] };
  }

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
