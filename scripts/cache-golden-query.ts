/**
 * Pre-compute and cache Sift's golden demo query.
 *
 * Runs the full live investigation once and writes the result to
 * src/data/cache.json via the cache module, so the demo serves instantly and
 * survives Nimble/Groq outages.
 *
 * Run with: npm run cache:golden
 */
import { config } from "dotenv";

// Load NIMBLE_* / GROQ_API_KEY from .env.local before importing anything that
// reads them at construction time.
config({ path: ".env.local" });

const GOLDEN_QUERY = "wireless earbuds under $50";

async function main() {
  // Import after env is loaded so the clients see their credentials.
  const { investigate } = await import("../src/lib/investigator");
  const { setCachedResult } = await import("../src/lib/cache");

  console.log(`Investigating golden query: "${GOLDEN_QUERY}"...`);
  const result = await investigate(GOLDEN_QUERY);

  setCachedResult(GOLDEN_QUERY, result);

  console.log("\nCached to src/data/cache.json");
  console.log(`  total:   ${result.totalChecked}`);
  console.log(`  traps:   ${result.traps.length}`);
  console.log(`  trusted: ${result.trusted.length}`);
}

main().catch((err) => {
  console.error("Failed to cache golden query:", err);
  process.exit(1);
});
