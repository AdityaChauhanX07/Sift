/**
 * Groq-backed deal investigator.
 *
 * Sends all candidates to Groq in a single call and asks for a per-candidate
 * verdict. The model returns JSON; we parse it back into InvestigationResult[]
 * and degrade gracefully (mark as "trap") whenever anything goes wrong.
 */
import Groq from "groq-sdk";
import type { DealCandidate, InvestigationResult, Verdict } from "./types";

const MODEL = "llama-3.3-70b-versatile";

const SYSTEM_PROMPT = `You are Sift, a ruthless deal investigator. You analyze shopping deals and determine which are trustworthy and which are traps.

For each deal, evaluate:
1. PRICE ANALYSIS: Is the discount realistic? Is the price suspiciously low for the product category? Is there actually a discount or is "old_price" fabricated?
2. MERCHANT TRUST: Is this a known, reputable retailer (Amazon, Best Buy, Walmart, Target = generally trusted) or an unknown/suspicious merchant?
3. DEAL QUALITY: Is this actually a good deal, or is it a regular price disguised as a sale?
4. RED FLAGS: Look for signs of dropshipping, fake markups, bait-and-switch, or too-good-to-be-true pricing.

Be aggressive — most deals on the internet are NOT worth trusting. Only 15-30% should pass as "trusted."

Respond with ONLY valid JSON, no markdown, no explanation. Format:
{
  "results": [
    {
      "index": 0,
      "trustScore": 72,
      "verdict": "trusted",
      "flags": [],
      "evidence": ["Known retailer Best Buy", "Price consistent with market rate for this category"]
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
    }));

    const userPrompt = `Investigate these ${candidates.length} deals and return your JSON verdict for each by index:\n\n${JSON.stringify(
      dealsForModel,
      null,
      2,
    )}`;

    let content: string;
    try {
      const completion = await this.client.chat.completions.create({
        model: MODEL,
        temperature: 0.2,
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
