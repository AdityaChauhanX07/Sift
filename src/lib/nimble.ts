/**
 * Thin Nimble client for Sift.
 *
 * Wraps Nimble's realtime SERP API (the one path we verified during de-risk:
 * google_search with parse:true). Returns typed, parsed entities and strips the
 * giant raw `html_content` blob before handing anything back.
 */
import type { DealCandidate } from "./types";

const SERP_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp";

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
