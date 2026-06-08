/**
 * Shared domain types for Sift — the deal trust agent.
 *
 * The pipeline is: query -> Nimble SERP -> DealCandidate[] -> investigation ->
 * InvestigationResult[] -> SiftResult. Only the candidate stage is wired up so
 * far; the investigation types are defined here so the rest of the app can be
 * built against them.
 */

/**
 * A single shopping deal we found and may investigate. `nimbleRaw` keeps the
 * untouched Nimble entity around so later investigation steps can mine fields
 * we haven't promoted to first-class properties yet.
 */
export interface DealCandidate {
  title: string;
  price: string;
  /** Original / struck-through price, when the listing shows one. */
  oldPrice: string | null;
  merchant: string;
  thumbnailUrl: string | null;
  isOnSale: boolean;
  /** Link to the deal, when Nimble provides one (often empty for SERP). */
  sourceUrl: string | null;
  /** The raw Nimble entity this candidate was derived from. */
  nimbleRaw: unknown;
}

/** Verdict the agent reaches for a single candidate. */
export type Verdict = "trusted" | "trap";

/**
 * The result of investigating one candidate. `trustScore` is 0-100, `flags`
 * are short machine-ish tags (e.g. "fake_discount"), and `evidence` is
 * human-readable reasoning backing the verdict.
 */
export interface InvestigationResult {
  candidate: DealCandidate;
  trustScore: number;
  flags: string[];
  verdict: Verdict;
  evidence: string[];
}

/** The full response for one Sift run over a query. */
export interface SiftResult {
  query: string;
  totalChecked: number;
  traps: InvestigationResult[];
  trusted: InvestigationResult[];
}
