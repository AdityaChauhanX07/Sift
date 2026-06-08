/**
 * Thin Nimble client for Sift.
 *
 * Wraps Nimble's realtime SERP API (google_search with parse:true) for finding
 * candidates, and the realtime web (Extract) API for enriching a single product
 * page. Returns typed, parsed entities and strips the giant raw `html_content`
 * blob before handing anything back.
 */
import type { DealCandidate, EnrichedData } from "./types";

const SERP_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp";
const WEB_ENDPOINT = "https://api.webit.live/api/v1/realtime/web";

/** Per-call timeout for an Extract request, in milliseconds. */
const EXTRACT_TIMEOUT_MS = 15_000;

/**
 * A parsed Google Shopping result, as it appears under
 * `parsing.entities.ShoppingResult[]` in the Nimble SERP response.
 */
export interface ShoppingResult {
  entity_type: "ShoppingResult";
  title: string;
  price?: string;
  old_price?: string;
  is_on_sale?: boolean;
  /** Merchant / seller name, e.g. "Walmart", "Best Buy". */
  source?: string;
  item_link?: string;
  position?: number;
  thumbnail?: {
    alt?: string;
    image?: string;
  };
}

/**
 * A parsed organic Google result, as it appears under
 * `parsing.entities.OrganicResult[]` in the Nimble SERP response.
 */
export interface OrganicResult {
  entity_type: "OrganicResult";
  title: string;
  url: string;
  snippet?: string;
  displayed_url?: string;
  cleaned_domain?: string;
  position?: number;
}

/** What `searchDeals` returns: the two entity arrays we care about. */
export interface SearchDealsResult {
  shopping: ShoppingResult[];
  organic: OrganicResult[];
}

/**
 * Structured data Nimble Extract returns for a single product page.
 *
 * Deliberately open-ended: we haven't pinned the real shape yet (that's what
 * scripts/test-extract.ts is for). Once we've inspected a live response we can
 * promote the fields we actually use to first-class properties. The raw HTML is
 * always stripped before this leaves the client.
 */
export interface ExtractedProduct {
  status?: string;
  status_code?: number;
  msg?: string;
  parsing?: {
    entities?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Shape of the relevant slice of a Nimble SERP response. */
interface NimbleSerpResponse {
  status?: string;
  status_code?: number;
  msg?: string;
  html_content?: string;
  parsing?: {
    entities?: {
      ShoppingResult?: ShoppingResult[];
      OrganicResult?: OrganicResult[];
      [key: string]: unknown;
    };
  };
  [key: string]: unknown;
}

export class NimbleClient {
  private readonly authHeader: string;

  constructor() {
    const username = process.env.NIMBLE_USERNAME;
    const password = process.env.NIMBLE_PASSWORD;

    if (!username || !password) {
      throw new Error(
        "NIMBLE_USERNAME and NIMBLE_PASSWORD must be set in the environment",
      );
    }

    const token = Buffer.from(`${username}:${password}`).toString("base64");
    this.authHeader = `Basic ${token}`;
  }

  /**
   * Fire a SERP call for `query` and return the parsed shopping + organic
   * entities. Throws loudly on transport errors or non-success responses so
   * callers can surface a clean error.
   */
  async searchDeals(query: string): Promise<SearchDealsResult> {
    const res = await fetch(SERP_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parse: true,
        query,
        search_engine: "google_search",
        country: "US",
        locale: "en",
      }),
    });

    const text = await res.text();

    let json: NimbleSerpResponse;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(
        `Nimble returned non-JSON response (HTTP ${res.status}): ${text.slice(0, 500)}`,
      );
    }

    // Never let the giant raw HTML escape this client.
    delete json.html_content;

    if (!res.ok || json.status === "failed") {
      const reason = json.msg ?? res.statusText;
      throw new Error(`Nimble SERP request failed (HTTP ${res.status}): ${reason}`);
    }

    const entities = json.parsing?.entities ?? {};
    return {
      shopping: entities.ShoppingResult ?? [],
      organic: entities.OrganicResult ?? [],
    };
  }

  /**
   * Fetch and parse a single product page via Nimble's realtime web (Extract)
   * API. Used to enrich a candidate with real on-page data (price, reviews,
   * seller, etc.) before the LLM judges it.
   *
   * This is best-effort: it never throws. On a timeout (15s), transport error,
   * non-JSON body, or non-success response it returns null so the investigation
   * pipeline can degrade gracefully instead of crashing. The giant raw
   * `html_content` blob is stripped before returning.
   */
  async extractProductPage(url: string): Promise<ExtractedProduct | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

    try {
      const res = await fetch(WEB_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          render: false,
          country: "US",
          locale: "en",
          parse: true,
        }),
        signal: controller.signal,
      });

      const text = await res.text();

      let json: ExtractedProduct;
      try {
        json = JSON.parse(text);
      } catch {
        return null;
      }

      // Never let the giant raw HTML escape this client.
      delete json.html_content;

      if (!res.ok || json.status === "failed") return null;

      return json;
    } catch {
      // Timeout (abort) or transport error — degrade to null.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Distil a raw Nimble Extract response (Walmart product shape) down to the
   * verified fields Sift actually reasons over. Navigates
   * `parsing.entities.Product[0]` and pulls price, seller, and review data.
   *
   * Returns null if the shape is missing or carries nothing useful (e.g. a 404
   * placeholder page where price and reviews are absent/zero), so callers can
   * simply skip enrichment for that candidate.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseExtractedProduct(raw: any): EnrichedData | null {
    try {
      const entity = raw?.parsing?.entities?.Product?.[0];
      if (!entity || typeof entity !== "object") return null;

      const product = entity.product ?? {};
      const reviews = entity.reviews ?? {};
      const priceInfo = product.priceInfo ?? {};

      const str = (v: unknown): string | null =>
        typeof v === "string" && v.length > 0 ? v : null;
      const num = (v: unknown): number | null =>
        typeof v === "number" && !Number.isNaN(v) ? v : null;

      const realPrice = str(priceInfo.currentPrice?.priceString);
      const wasPrice = str(priceInfo.wasPrice?.priceString);
      const isPriceReduced = priceInfo.isPriceReduced === true;

      const sellerName = str(product.sellerName);
      const brand = str(product.brand);
      const inStock = product.availabilityStatus === "IN_STOCK";

      const averageRating = num(reviews.averageOverallRating);
      const totalReviews = num(reviews.totalReviewCount);
      const reviewsWithText = num(reviews.reviewsWithTextCount);
      const recommendedPercent = num(reviews.recommendedPercentage);

      const hasDistribution =
        typeof reviews.ratingValueFiveCount === "number" ||
        typeof reviews.ratingValueOneCount === "number";
      const ratingDistribution = hasDistribution
        ? {
            stars5: num(reviews.ratingValueFiveCount) ?? 0,
            stars4: num(reviews.ratingValueFourCount) ?? 0,
            stars3: num(reviews.ratingValueThreeCount) ?? 0,
            stars2: num(reviews.ratingValueTwoCount) ?? 0,
            stars1: num(reviews.ratingValueOneCount) ?? 0,
          }
        : null;

      // Nothing useful came back (e.g. a dead/placeholder page) — skip it.
      if (!realPrice && !averageRating && !totalReviews) return null;

      return {
        realPrice,
        wasPrice,
        isPriceReduced,
        sellerName,
        brand,
        inStock,
        averageRating,
        totalReviews,
        reviewsWithText,
        recommendedPercent,
        ratingDistribution,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Map a raw Nimble ShoppingResult into Sift's normalized DealCandidate shape.
 */
export function toDealCandidate(result: ShoppingResult): DealCandidate {
  return {
    title: result.title,
    price: result.price ?? "",
    oldPrice: result.old_price ?? null,
    merchant: result.source ?? "",
    thumbnailUrl: result.thumbnail?.image ?? null,
    isOnSale: result.is_on_sale ?? false,
    sourceUrl: result.item_link ? result.item_link : null,
    nimbleRaw: result,
  };
}
