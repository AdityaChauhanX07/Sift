/**
 * De-risk script: hit Nimble's realtime web (Extract) API on a real product
 * page and dump the full parsed JSON so we can see its shape before wiring
 * Extract into the investigation pipeline.
 *
 * Run with:
 *   npm run test:extract                       # auto-pick a URL from live SERP
 *   npm run test:extract -- "<product-url>"    # extract a specific URL
 *
 * Nimble discipline: one live call → inspect the response shape → then build
 * against the real format, not the docs.
 */
import { config } from "dotenv";

// Load NIMBLE_USERNAME / NIMBLE_PASSWORD from .env.local before constructing
// the client (its constructor reads them).
config({ path: ".env.local" });

import { NimbleClient } from "../src/lib/nimble";

const WEB_ENDPOINT = "https://api.webit.live/api/v1/realtime/web";
const EXTRACT_TIMEOUT_MS = 15_000;

const GOLDEN_QUERY = "wireless earbuds under $50";

/** Build the same Basic auth header NimbleClient uses, from env. */
function authHeader(): string {
  const username = process.env.NIMBLE_USERNAME;
  const password = process.env.NIMBLE_PASSWORD;
  if (!username || !password) {
    throw new Error("NIMBLE_USERNAME / NIMBLE_PASSWORD missing in .env.local");
  }
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

/**
 * Diagnostic version of extractProductPage: same request, but logs the actual
 * error / response status / body before returning null, so we can see WHY a
 * page fails to extract instead of just getting a silent null.
 */
async function diagnosticExtract(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    const res = await fetch(WEB_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
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

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      console.error(`HTTP ${res.status} ${res.statusText} — non-JSON body:`);
      console.error(text.slice(0, 2000));
      return null;
    }

    delete json.html_content;

    if (!res.ok || json.status === "failed") {
      console.error(`Nimble Extract failed — HTTP ${res.status} ${res.statusText}`);
      console.error(`status: ${json.status ?? "?"}  msg: ${json.msg ?? "?"}`);
      console.error("Full response body (html stripped):");
      console.error(JSON.stringify(json, null, 2));
      return null;
    }

    return json;
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    console.error(
      aborted
        ? `Request aborted after ${EXTRACT_TIMEOUT_MS}ms timeout`
        : `Transport error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Prefer real product pages from retailers Extract is likely to parse well.
const PREFERRED_DOMAINS = [
  "bestbuy.com",
  "walmart.com",
  "target.com",
  "amazon.com",
];

/** Find a usable product URL from live SERP results for the golden query. */
async function pickUrlFromSerp(client: NimbleClient): Promise<string | null> {
  const { shopping, organic } = await client.searchDeals(GOLDEN_QUERY);

  // Gather every candidate URL the SERP gave us.
  const urls: string[] = [
    ...shopping.map((s) => s.item_link).filter((u): u is string => !!u),
    ...organic.map((o) => o.url).filter((u): u is string => !!u),
  ];

  // Prefer a known retailer product page; otherwise take the first URL we have.
  const preferred = urls.find((u) =>
    PREFERRED_DOMAINS.some((d) => u.includes(d)),
  );
  return preferred ?? urls[0] ?? null;
}

async function main() {
  const client = new NimbleClient();

  const cliUrl = process.argv[2];
  const url = cliUrl ?? (await pickUrlFromSerp(client));

  if (!url) {
    console.error(
      "No URL to extract — none provided and SERP returned no usable links.",
    );
    process.exit(1);
  }

  console.log(`Extracting: ${url}\n`);

  const result = await diagnosticExtract(url);

  if (result === null) {
    console.error("\nExtract returned null — see error above.");
    process.exit(1);
  }

  // html_content is already stripped; print the rest in full.
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("test:extract failed:", err);
  process.exit(1);
});
