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

/** Per-call timeout for an AliExpress source-lookup SERP request, in ms. */
const ALIEXPRESS_TIMEOUT_MS = 15_000;

/** Per-call timeout for a product-URL lookup SERP request, in ms. */
const FIND_URL_TIMEOUT_MS = 15_000;

/**
 * Retailers whose product pages we can find + extract, with the URL path that
 * marks a real product page (vs. a search/category page) on that domain.
 * `preferPath`, when set, is tried first: Best Buy's schema.org JSON-LD lives on
 * its /site/reviews/ pages, so we prefer those over a bare /site/ match.
 */
const EXTRACTABLE_RETAILERS: {
  match: RegExp;
  domain: string;
  productPath: string;
  preferPath?: string;
}[] = [
  { match: /walmart/i, domain: "walmart.com", productPath: "/ip/" },
  {
    match: /best ?buy/i,
    domain: "bestbuy.com",
    productPath: "/site/",
    preferPath: "/site/reviews/",
  },
  { match: /target/i, domain: "target.com", productPath: "/p/" },
];

/** Pull the first "$X.XX" price out of a snippet, if any. */
function priceFromSnippet(snippet: string): string | undefined {
  const match = snippet.match(/\$\s?\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?/);
  return match ? match[0].replace(/\s/g, "") : undefined;
}

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
 * A candidate AliExpress source listing, distilled from an organic Google result
 * that points at aliexpress.com. `price` is the raw "$X.XX" string scraped from
 * the snippet when present — callers parse it into a number for markup math.
 */
export interface AliExpressResult {
  title: string;
  url: string;
  snippet: string;
  price?: string;
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
   * Find the AliExpress source listing(s) for a product by running a
   * `site:aliexpress.com` SERP query for its title. Used to surface dropship
   * markup: a $24 earbud whose source sells for $3 is a 8x markup.
   *
   * Best-effort like Extract: it never throws. On a timeout (15s), transport
   * error, non-JSON body, or non-success response it returns an empty array so
   * the investigation pipeline degrades gracefully. Only organic results whose
   * URL is on aliexpress.com are returned; prices are scraped from the snippet
   * when present.
   */
  async searchAliExpress(productTitle: string): Promise<AliExpressResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ALIEXPRESS_TIMEOUT_MS);

    try {
      const res = await fetch(SERP_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parse: true,
          query: `${productTitle} site:aliexpress.com`,
          search_engine: "google_search",
          country: "US",
          locale: "en",
        }),
        signal: controller.signal,
      });

      const text = await res.text();

      let json: NimbleSerpResponse;
      try {
        json = JSON.parse(text);
      } catch {
        return [];
      }

      // Never let the giant raw HTML escape this client.
      delete json.html_content;

      if (!res.ok || json.status === "failed") return [];

      const organic = json.parsing?.entities?.OrganicResult ?? [];
      return organic
        .filter((o) => /aliexpress\.com/i.test(o.url ?? ""))
        .map((o) => {
          const snippet = o.snippet ?? "";
          return {
            title: o.title,
            url: o.url,
            snippet,
            price: priceFromSnippet(snippet),
          };
        });
    } catch {
      // Timeout (abort) or transport error — degrade to an empty list.
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Find the product-page URL for a candidate via a `site:<retailer>` SERP
   * query. SERP shopping results rarely carry a usable item_link, so we search
   * the retailer's own domain and pick the first organic result that looks like
   * a real product page (e.g. /ip/ on Walmart) rather than a search/category
   * page. That URL is what extractProductPage then enriches.
   *
   * Returns null when the retailer isn't one we can extract, or when nothing
   * usable comes back. Best-effort: never throws (15s timeout → null).
   */
  async findProductUrl(title: string, retailer: string): Promise<string | null> {
    const entry = EXTRACTABLE_RETAILERS.find((r) => r.match.test(retailer));
    if (!entry) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FIND_URL_TIMEOUT_MS);

    try {
      const res = await fetch(SERP_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parse: true,
          query: `${title} site:${entry.domain}`,
          search_engine: "google_search",
          country: "US",
          locale: "en",
        }),
        signal: controller.signal,
      });

      const text = await res.text();

      let json: NimbleSerpResponse;
      try {
        json = JSON.parse(text);
      } catch {
        return null;
      }

      // Never let the giant raw HTML escape this client.
      delete json.html_content;

      if (!res.ok || json.status === "failed") return null;

      const organic = json.parsing?.entities?.OrganicResult ?? [];
      const onDomainWith = (path: string) =>
        organic.find((o) => {
          const url = o.url ?? "";
          return url.includes(entry.domain) && url.includes(path);
        });

      // Prefer the data-bearing path (e.g. Best Buy /site/reviews/) when set,
      // then fall back to the generic product path.
      const match =
        (entry.preferPath && onDomainWith(entry.preferPath)) ||
        onDomainWith(entry.productPath);

      return match?.url ?? null;
    } catch {
      // Timeout (abort) or transport error — degrade to null.
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch and parse a single product page via Nimble's realtime web (Extract)
   * API. Used to enrich a candidate with real on-page data (price, reviews,
   * seller, etc.) before the LLM judges it.
   *
   * This is best-effort: it never throws. On a timeout, transport error,
   * non-JSON body, or non-success response it returns null so the investigation
   * pipeline can degrade gracefully instead of crashing. The giant raw
   * `html_content` blob is stripped before returning.
   *
   * `options.render` enables JS rendering (needed for sites like Best Buy whose
   * product data is client-rendered); it's slower, so `options.timeout` lets
   * callers extend the default 15s budget. Defaults keep Walmart calls unchanged.
   */
  async extractProductPage(
    url: string,
    options: { render?: boolean; timeout?: number } = {},
  ): Promise<ExtractedProduct | null> {
    const { render = false, timeout: timeoutMs = EXTRACT_TIMEOUT_MS } = options;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(WEB_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
          render,
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
   * Distil a raw Nimble Extract response down to the verified fields Sift
   * reasons over. Walmart and Best Buy both surface under
   * `parsing.entities.Product[0]` but in different shapes, so detect which and
   * route to the matching parser:
   *  - Best Buy: a schema.org entity with `@type === "Product"`.
   *  - Walmart: a proprietary entity carrying a nested `product` sub-object.
   *
   * Returns null when the shape is unrecognized, missing, or carries nothing
   * useful, so callers can simply skip enrichment for that candidate.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseExtractedProduct(raw: any): EnrichedData | null {
    const entity = raw?.parsing?.entities?.Product?.[0];
    if (!entity || typeof entity !== "object") return null;

    if (entity["@type"] === "Product") return this.parseBestBuyProduct(raw);
    if (entity.product && typeof entity.product === "object") {
      return this.parseWalmartProduct(raw);
    }
    return null;
  }

  /**
   * Parse Walmart's proprietary Extract shape (nested `product` / `reviews`
   * objects under `parsing.entities.Product[0]`). Returns null if nothing
   * useful is present (e.g. a dead/placeholder page).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseWalmartProduct(raw: any): EnrichedData | null {
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

  /**
   * Parse Best Buy's schema.org Extract shape: a `Product` entity with `offers`,
   * `brand`, and `aggregateRating`. Best Buy doesn't expose a struck-through
   * price, recommended-percentage, or full rating distribution, so those stay
   * null/false. `reviewsWithText` reflects the sampled `Review[]` count, not a
   * platform total. Returns null when nothing useful is present.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseBestBuyProduct(raw: any): EnrichedData | null {
    try {
      const entity = raw?.parsing?.entities?.Product?.[0];
      if (!entity || typeof entity !== "object") return null;

      const str = (v: unknown): string | null =>
        typeof v === "string" && v.length > 0 ? v : null;
      const num = (v: unknown): number | null =>
        typeof v === "number" && !Number.isNaN(v) ? v : null;

      const offers = entity.offers ?? {};
      const priceNum = num(offers.price);
      const realPrice = priceNum !== null ? `$${priceNum.toFixed(2)}` : null;

      const sellerName = str(offers.seller?.name);
      const brand = str(entity.brand?.name);
      const inStock =
        typeof offers.availability === "string" &&
        offers.availability.includes("InStock");

      const rating = entity.aggregateRating ?? {};
      const averageRating = num(rating.ratingValue);
      const totalReviews = num(rating.reviewCount);

      const sampled = raw?.parsing?.entities?.Review;
      const reviewsWithText =
        Array.isArray(sampled) && sampled.length > 0 ? sampled.length : null;

      // Nothing useful came back (e.g. a redirect/SPA page) — skip it.
      if (!realPrice && !averageRating && !totalReviews) return null;

      return {
        realPrice,
        wasPrice: null,
        isPriceReduced: false,
        sellerName,
        brand,
        inStock,
        averageRating,
        totalReviews,
        reviewsWithText,
        recommendedPercent: null,
        ratingDistribution: null,
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
