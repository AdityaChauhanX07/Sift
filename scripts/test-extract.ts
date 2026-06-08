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

const GOLDEN_QUERY = "wireless earbuds under $50";

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

  const result = await client.extractProductPage(url);

  if (result === null) {
    console.error("Extract returned null (timeout, error, or non-success).");
    process.exit(1);
  }

  // html_content is already stripped by the client; print the rest in full.
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("test:extract failed:", err);
  process.exit(1);
});
