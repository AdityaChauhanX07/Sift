/**
 * Investigation orchestration for Sift.
 *
 * Ties the Nimble search and the Groq investigator together: query -> candidates
 * -> verdicts -> a single SiftResult split into traps vs. trusted.
 */
import { NimbleClient, toDealCandidate } from "./nimble";
import { GroqInvestigator } from "./groq";
import type { DealCandidate, SiftResult } from "./types";

/**
 * Run the full pipeline for a query and return a partitioned SiftResult.
 * Throws if Nimble or Groq fail; the API route turns that into an HTTP error.
 */
export async function investigate(query: string): Promise<SiftResult> {
  const nimble = new NimbleClient();
  const { shopping } = await nimble.searchDeals(query);

  const candidates: DealCandidate[] = shopping.map(toDealCandidate);

  // Nothing to investigate — return an empty-but-valid result.
  if (candidates.length === 0) {
    return { query, totalChecked: 0, traps: [], trusted: [] };
  }

  const groq = new GroqInvestigator();
  const results = await groq.investigateDeals(candidates);

  const traps = results.filter((r) => r.verdict === "trap");
  const trusted = results.filter((r) => r.verdict === "trusted");

  return {
    query,
    totalChecked: results.length,
    traps,
    trusted,
  };
}
