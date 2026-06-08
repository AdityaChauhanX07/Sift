/**
 * De-risk script: hit Nimble's Search API once with a raw HTTP request and
 * dump the full JSON response so we can inspect its real shape.
 *
 * Run with: npm run test:nimble
 *
 * No try/catch — if anything is wrong (missing key, bad request, network),
 * we want it to crash loud with the real error.
 */
import { config } from "dotenv";

// Load NIMBLE_API_KEY (and friends) from .env.local
config({ path: ".env.local" });

const NIMBLE_API_KEY = process.env.NIMBLE_API_KEY;

if (!NIMBLE_API_KEY) {
  throw new Error("NIMBLE_API_KEY is missing — set it in .env.local");
}

const ENDPOINT = "https://api.webit.live/api/v1/realtime/serp";

const body = {
  parse: true,
  query: "wireless earbuds under 50",
  search_engine: "google_shopping",
  country: "US",
  locale: "en",
};

const main = async () => {
  const authToken = Buffer.from(NIMBLE_API_KEY).toString("base64");

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  console.log(`HTTP ${res.status} ${res.statusText}`);

  // Read the raw text first so we can still see the body on a non-2xx status,
  // then parse + pretty-print the JSON.
  const text = await res.text();
  const json = JSON.parse(text);
  console.log(JSON.stringify(json, null, 2));
};

// Top-level await would also work, but call main() so an unhandled rejection
// surfaces with a full stack trace and a non-zero exit code.
main();
