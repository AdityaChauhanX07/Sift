/**
 * De-risk script: exercise NimbleClient.searchAliExpress against a keyword-
 * stuffed title (the kind of dropship listing Sift flags) and print the source
 * matches it finds, with any prices scraped from the snippets.
 *
 * Run with: npm run test:aliexpress
 */
import { config } from "dotenv";

// Load NIMBLE_USERNAME / NIMBLE_PASSWORD before constructing the client.
config({ path: ".env.local" });

const TEST_TITLE =
  "Wireless Earbuds Bluetooth 5.3 Stereo Bass Sports Headphones";

async function main() {
  // Import after env is loaded so the client sees its credentials.
  const { NimbleClient } = await import("../src/lib/nimble");
  const nimble = new NimbleClient();

  console.log(`Searching AliExpress for:\n  "${TEST_TITLE}"\n`);

  const results = await nimble.searchAliExpress(TEST_TITLE);

  if (results.length === 0) {
    console.log("No AliExpress results found (or the lookup failed/timed out).");
    return;
  }

  console.log(`Found ${results.length} AliExpress result(s):\n`);
  results.forEach((r, i) => {
    console.log(`[${i + 1}] ${r.title}`);
    console.log(`    price:   ${r.price ?? "—"}`);
    console.log(`    url:     ${r.url}`);
    console.log(`    snippet: ${r.snippet.slice(0, 160)}`);
    console.log("");
  });
}

main().catch((err) => {
  console.error("test:aliexpress failed:", err);
  process.exit(1);
});
