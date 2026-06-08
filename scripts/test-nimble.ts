/**
 * De-risk script: hit Nimble's realtime APIs and dump the full JSON responses
 * so we can inspect their real shapes.
 *
 * Run with: npm run test:nimble
 *
 * Makes TWO independent calls (SERP + e-commerce). Each is isolated: if one
 * fails we print the error and still run the other.
 */
import { config } from "dotenv";

// Load NIMBLE_USERNAME / NIMBLE_PASSWORD (and friends) from .env.local
config({ path: ".env.local" });

const NIMBLE_USERNAME = process.env.NIMBLE_USERNAME;
const NIMBLE_PASSWORD = process.env.NIMBLE_PASSWORD;

if (!NIMBLE_USERNAME || !NIMBLE_PASSWORD) {
  throw new Error(
    "NIMBLE_USERNAME and/or NIMBLE_PASSWORD are missing — set them in .env.local",
  );
}

const SERP_ENDPOINT = "https://api.webit.live/api/v1/realtime/serp";
const ECOMMERCE_ENDPOINT = "https://api.webit.live/api/v1/realtime/ecommerce";

const authToken = Buffer.from(
  `${NIMBLE_USERNAME}:${NIMBLE_PASSWORD}`,
).toString("base64");

const serpBody = {
  parse: true,
  query: "wireless earbuds under $50 best deals",
  search_engine: "google_search",
  country: "US",
  locale: "en",
};

const ecommerceBody = {
  parse: true,
  url: "https://www.amazon.com/dp/B0BT35LT8S",
  vendor: "amazon",
  country: "US",
  locale: "en",
};

/**
 * POST a body to a Nimble endpoint and pretty-print the full JSON response.
 * Reads the raw text first so a non-2xx body is still visible.
 */
const callNimble = async (endpoint: string, body: unknown) => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);

  const text = await res.text();
  const json = JSON.parse(text);

  // Drop the giant raw HTML so the output stays readable; print everything else.
  if (json && typeof json === "object") {
    delete json.html_content;
  }

  console.log(JSON.stringify(json, null, 2));
};

const main = async () => {
  console.log("=== SERP RESPONSE ===");
  try {
    await callNimble(SERP_ENDPOINT, serpBody);
  } catch (err) {
    console.error("SERP call failed:", err);
  }

  console.log("\n=== ECOMMERCE RESPONSE ===");
  try {
    await callNimble(ECOMMERCE_ENDPOINT, ecommerceBody);
  } catch (err) {
    console.error("ECOMMERCE call failed:", err);
  }
};

main();
