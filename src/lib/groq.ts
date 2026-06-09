/**
 * Groq-backed deal investigator.
 *
 * Sends all candidates to Groq in a single call and asks for a per-candidate
 * verdict. The model returns JSON; we parse it back into InvestigationResult[]
 * and degrade gracefully (mark as "trap") whenever anything goes wrong.
 */
import Groq from "groq-sdk";
import type { OrganicResult } from "./nimble";
import type {
  DealCandidate,
  EnrichedData,
  InvestigationResult,
  Verdict,
} from "./types";

const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are Sift, a ruthless deal investigator. You analyze shopping deals to separate genuine bargains from traps.

Some candidates include VERIFIED DATA from direct product page extraction (real price, seller, and review distribution). Weight this heavily — it's real, not inferred. Prefer it over surface signals like the title or SERP price, and cite the specific numbers (price, review count, % recommended) in your evidence.

Some candidates include SOURCE MATCH data showing the same product found on AliExpress. When you flag this, write a SHORT flag (10 words max), never a paragraph and never the raw SOURCE MATCH text. With a price, use the markup: "Found on AliExpress for $1.75 — 8.5x markup". Without a price: "Same product found on AliExpress — likely dropshipped".

ANALYSIS FRAMEWORK for each deal:
1. MERCHANT TRUST: Tier 1 (Amazon, Best Buy, Walmart, Target, Costco) = baseline trust. Tier 2 (known brands selling direct like JLab, Skullcandy, Soundcore via their own site) = moderate trust. Tier 3 (unknown merchants, marketplace sellers like "WJyouxuan", random resellers) = low trust.
2. PRICE RED FLAGS: Items under $5 for electronics = almost certainly dropship junk from AliExpress. "Was $X, now $Y" where the discount is over 60% = likely inflated original price. Multiple sellers listing the exact same product at wildly different prices = arbitrage/dropship.
3. LISTING QUALITY: Keyword-stuffed titles ("Bluetooth 5.3 Earbuds Stereo Bass Sports Headphones in Ear Noise Cancelling") = classic dropship/marketplace spam. Clean, specific product names (e.g. "JLab Go Air Pop") = legitimate product.
4. DEAL AUTHENTICITY: Is this a real sale or an everyday price disguised as a deal? Is the "original price" real or fabricated?

SEVERITY RULES:
- Be AGGRESSIVE. Most internet deals are traps. Only 20-30% should pass as "trusted."
- PRODUCT RELEVANCE: If a listing is clearly NOT the product category the user searched for (e.g. a charging case when searching for earbuds, a phone mount when searching for headphones), verdict: trap. Flag: "Wrong product category — not what was searched for"
- Tier 3 merchants selling sub-$10 electronics = ALWAYS a trap
- Keyword-stuffed titles = ALWAYS a trap
- Same product appearing from multiple unknown sellers at rock-bottom prices = trap
- Known retailers at reasonable prices with clean listings = trusted

For EACH deal, provide:
- Specific, varied evidence (not generic "known retailer" — say WHY it's trusted or WHY it's a trap)
- Flags should be concrete: "Title is keyword-stuffed spam", "Price $2.44 suggests AliExpress dropship", "WJyouxuan is an unknown marketplace seller", "50% off from Best Buy is a verified seasonal sale"

CRITICAL SEVERITY RULES — be harsh:
- A known retailer listing a product at its REGULAR price is NOT a deal. Verdict: trap. Flag: "Regular price disguised as a deal — no actual savings"
- If there's no old_price / no discount shown, it's not a deal unless the price is genuinely exceptional for the category. Verdict: trap. Flag: "No verified discount"
- Duplicate listings (same product from same or different sellers) = trap for all but the best-priced one. Flag: "Duplicate listing — better price available elsewhere in results"
- Review/comparison sites (rtings.com, wirecutter, etc.) are provided ONLY as supporting context, never as candidates. Use them as evidence — e.g. "rtings.com recommends this model" supports a trusted verdict. Do NOT judge or flag them.
- Only 20-30% of ALL candidates should survive as "trusted". If you're approving more than that, you're being too lenient.

Respond with ONLY valid JSON, no markdown. Format:
{
  "results": [
    {
      "index": 0,
      "trustScore": 72,
      "verdict": "trusted",
      "flags": [],
      "evidence": ["Best Buy is a Tier 1 retailer with buyer protection", "32% discount on JLab is consistent with their regular sale cycles"]
    }
  ]
}`;

/** Shape of a single result entry as returned by the LLM. */
interface RawVerdict {
  index?: number;
  trustScore?: number;
  verdict?: string;
  flags?: unknown;
  evidence?: unknown;
}

interface RawResponse {
  results?: RawVerdict[];
}

/** A failed/unparseable verdict for one candidate. */
function failedResult(candidate: DealCandidate): InvestigationResult {
  return {
    candidate,
    trustScore: 0,
    flags: ["Analysis failed"],
    verdict: "trap",
    evidence: ["Investigation could not be completed for this deal."],
  };
}

/** Coerce a model verdict string into our Verdict union. */
function normalizeVerdict(value: unknown): Verdict {
  return value === "trusted" ? "trusted" : "trap";
}

/** Coerce an unknown into a string[] (model sometimes returns odd shapes). */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** Clamp a trust score into 0-100, defaulting to 0. */
function normalizeScore(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Whole-number percentage of `part` within `total` (0 when total is 0). */
function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

/** First-party retailers whose own listings carry buyer protection. */
const FIRST_PARTY_SELLER = /walmart\.com|amazon\.com|bestbuy\.com|target\.com|costco\.com/i;

/**
 * Render verified Extract data as one human-readable line for the LLM prompt.
 * e.g. "VERIFIED DATA: Real price $16.99 (was $29.38, genuine sale). Seller:
 * Walmart.com (1st party). Rating: 4.5/5 from 39,018 reviews ..."
 */
function formatEnrichment(e: EnrichedData): string {
  const parts: string[] = [];

  if (e.realPrice) {
    const sale = e.wasPrice
      ? ` (was ${e.wasPrice}, ${e.isPriceReduced ? "genuine sale" : "no real reduction"})`
      : "";
    parts.push(`Real price ${e.realPrice}${sale}.`);
  }

  if (e.sellerName) {
    const party = FIRST_PARTY_SELLER.test(e.sellerName)
      ? "1st party"
      : "marketplace seller";
    parts.push(`Seller: ${e.sellerName} (${party}).`);
  }

  if (e.brand) parts.push(`Brand: ${e.brand}.`);
  if (e.inStock === false) parts.push("Currently out of stock.");

  if (e.averageRating !== null && e.totalReviews !== null) {
    const detail = [
      e.reviewsWithText !== null
        ? `${e.reviewsWithText.toLocaleString()} with text`
        : null,
      e.recommendedPercent !== null
        ? `${e.recommendedPercent}% recommended`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    parts.push(
      `Rating: ${e.averageRating}/5 from ${e.totalReviews.toLocaleString()} reviews${
        detail ? ` (${detail})` : ""
      }.`,
    );
  }

  if (e.ratingDistribution) {
    const d = e.ratingDistribution;
    const total = d.stars5 + d.stars4 + d.stars3 + d.stars2 + d.stars1;
    parts.push(
      `Distribution: 5★ ${pct(d.stars5, total)}%, 4★ ${pct(d.stars4, total)}%, 3★ ${pct(
        d.stars3,
        total,
      )}%, 2★ ${pct(d.stars2, total)}%, 1★ ${pct(d.stars1, total)}%.`,
    );
  }

  return `VERIFIED DATA: ${parts.join(" ")}`;
}

/**
 * Render an AliExpress source match as one SHORT line for the LLM prompt. We drop
 * the long title + URL so the model has a terse input and produces terse flags.
 * With a price we quote the markup; without one, the match alone is the evidence.
 */
function formatSourceMatch(s: NonNullable<DealCandidate["sourceMatch"]>): string {
  if (s.aliExpressPrice !== null) {
    const markup = s.markup !== null ? ` (${s.markup}x markup)` : "";
    return `SOURCE MATCH: Found on AliExpress for $${s.aliExpressPrice.toFixed(2)}${markup}`;
  }
  return `SOURCE MATCH: Found on AliExpress (likely dropshipped)`;
}

export class GroqInvestigator {
  private readonly client: Groq;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY must be set in the environment");
    }
    this.client = new Groq({ apiKey });
  }

  /**
   * Investigate every candidate in a single Groq call. Returns one
   * InvestigationResult per input candidate, in the same order. Any candidate
   * the model omits or returns garbage for falls back to a "trap" verdict.
   */
  async investigateDeals(
    candidates: DealCandidate[],
    organic: OrganicResult[] = [],
  ): Promise<InvestigationResult[]> {
    if (candidates.length === 0) return [];

    // Send a compact view — the model doesn't need nimbleRaw, and dropping it
    // keeps the prompt small.
    const dealsForModel = candidates.map((c, index) => ({
      index,
      title: c.title,
      price: c.price,
      old_price: c.oldPrice,
      merchant: c.merchant,
      is_on_sale: c.isOnSale,
      // Real on-page data, when we extracted it — JSON.stringify drops this key
      // for un-enriched candidates.
      verified_data: c.enrichment ? formatEnrichment(c.enrichment) : undefined,
      // AliExpress source/markup, when we found it — same drop-when-undefined.
      source_match: c.sourceMatch ? formatSourceMatch(c.sourceMatch) : undefined,
    }));

    // Organic results aren't candidates — feed them as supporting context so the
    // model can cite review sites as evidence rather than judging them.
    const contextBlock =
      organic.length > 0
        ? `\n\nCONTEXT FROM REVIEW SITES (use as supporting evidence, these are NOT candidates):\n${organic
            .map(
              (o) =>
                `- ${o.title} (${o.cleaned_domain ?? o.displayed_url ?? "unknown"})${
                  o.snippet ? `: ${o.snippet}` : ""
                }`,
            )
            .join("\n")}`
        : "";

    const userPrompt = `Investigate these ${candidates.length} deals and return your JSON verdict for each by index:\n\n${JSON.stringify(
      dealsForModel,
      null,
      2,
    )}${contextBlock}\n\nRemember: only 20-30% should be trusted. Be ruthless.`;

    let content: string;
    try {
      const completion = await this.client.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
      });
      content = completion.choices[0]?.message?.content ?? "";
    } catch (err) {
      // Transport / API error — surface it so the route returns a clean error.
      const message = err instanceof Error ? err.message : "Unknown Groq error";
      throw new Error(`Groq investigation request failed: ${message}`);
    }

    let parsed: RawResponse;
    try {
      parsed = JSON.parse(content);
    } catch {
      // Model returned non-JSON: degrade every candidate to "trap".
      return candidates.map(failedResult);
    }

    const byIndex = new Map<number, RawVerdict>();
    for (const r of parsed.results ?? []) {
      if (typeof r.index === "number") byIndex.set(r.index, r);
    }

    return candidates.map((candidate, index) => {
      const raw = byIndex.get(index);
      if (!raw) return failedResult(candidate);

      return {
        candidate,
        trustScore: normalizeScore(raw.trustScore),
        verdict: normalizeVerdict(raw.verdict),
        flags: toStringArray(raw.flags),
        evidence: toStringArray(raw.evidence),
      };
    });
  }
}
