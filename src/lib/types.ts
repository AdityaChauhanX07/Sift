/**
 * Shared domain types for Sift — the deal trust agent.
 *
 * The pipeline is: query -> Nimble SERP -> DealCandidate[] -> investigation ->
 * InvestigationResult[] -> SiftResult. Only the candidate stage is wired up so
 * far; the investigation types are defined here so the rest of the app can be
 * built against them.
 */

/**
 * Verified product data pulled directly from a listing's page via Nimble
 * Extract. Unlike the SERP metadata on DealCandidate, these are real on-page
 * facts (true price, seller, review distribution) — the LLM should weight them
 * heavily over inferred signals.
 */
export interface EnrichedData {
  realPrice: string | null;
  wasPrice: string | null;
  isPriceReduced: boolean;
  sellerName: string | null;
  brand: string | null;
  inStock: boolean;
  averageRating: number | null;
  totalReviews: number | null;
  reviewsWithText: number | null;
  recommendedPercent: number | null;
  ratingDistribution: {
    stars5: number;
    stars4: number;
    stars3: number;
    stars2: number;
    stars1: number;
  } | null;
}

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
  /** Verified data from direct product-page extraction, when available. */
  enrichment?: EnrichedData;
  /**
   * The same/similar product located at its AliExpress source, when found —
   * evidence of dropship markup. `markup` is a multiplier (9.2 = 9.2x).
   */
  sourceMatch?: {
    aliExpressTitle: string;
    aliExpressPrice: number | null;
    aliExpressUrl: string;
    markup: number | null;
  };
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

/**
 * A single progress event streamed from the investigation pipeline to the client
 * as NDJSON. The intermediate stages drive the live progress panel; `complete`
 * carries the final SiftResult in `data`, and `error` carries a `message`.
 */
export interface ProgressEvent {
  stage:
    | "searching"
    | "found"
    | "source_lookup"
    | "investigating"
    | "enriching"
    | "complete"
    | "error";
  /** Human-readable line shown in the progress panel. */
  message?: string;
  /** Candidate count, for the "found" stage. */
  count?: number;
  /** Progress counters for stepped stages (e.g. source lookups). */
  current?: number;
  total?: number;
  /** The full result, present only on the "complete" stage. */
  data?: SiftResult;
}

/** Callback the pipeline calls to report progress as it works. */
export type ProgressFn = (event: ProgressEvent) => void;
