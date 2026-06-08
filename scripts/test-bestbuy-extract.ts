/**
 * De-risk script: pull a Best Buy product page via Nimble Extract and dump the
 * full parsed response so we can see the exact schema.org Product/Review shape
 * before writing a parser for it.
 *
 * Finding so far: the canonical product page (/site/<slug>/<sku>.p) 301-redirects
 * to Best Buy's new /product/<slug>/<id> SPA, which Nimble parses to ZERO
 * entities (even with render:true). The schema.org Product/Review JSON-LD shows
 * up on the /site/reviews/<slug>/<sku> page with render:FALSE — so we probe both
 * and print what each returns.
 *
 * Run with: npm run test:bestbuy
 */
import { config } from "dotenv";

// Load NIMBLE_* before constructing the client.
config({ path: ".env.local" });

const TITLE = "JLab Go Air Pop True Wireless Earbuds";

async function probe(
  nimble: import("../src/lib/nimble").NimbleClient,
  label: string,
  url: string,
  options: { render?: boolean; timeout?: number },
) {
  console.log(`\n=== ${label} ===`);
  console.log(`url:     ${url}`);
  console.log(`options: ${JSON.stringify(options)}`);
  const raw = await nimble.extractProductPage(url, options);
  if (!raw) {
    console.log("result:  null (timeout / transport / non-success)");
    return;
  }
  const ents = (raw as { parsing?: { entities?: Record<string, unknown> } })
    .parsing?.entities;
  console.log(`status:  ${(raw as { status_code?: number }).status_code}`);
  console.log(`final:   ${(raw as { final_url?: string }).final_url ?? url}`);
  console.log(`entities: ${ents ? Object.keys(ents).join(", ") || "(none)" : "(none)"}`);
  console.log("full response (html_content stripped):");
  console.log(JSON.stringify(raw, null, 2));
}

async function main() {
  const { NimbleClient } = await import("../src/lib/nimble");
  const nimble = new NimbleClient();

  console.log(`Finding Best Buy URL for: "${TITLE}"`);
  const found = await nimble.findProductUrl(TITLE, "Best Buy");
  console.log(`  findProductUrl returned: ${found ?? "null"}`);

  // Use whatever findProductUrl gave us (a /site/reviews/<slug>/<sku> URL), and
  // derive the canonical product .p URL from its slug + SKU.
  const reviewsUrl =
    found ??
    "https://www.bestbuy.com/site/reviews/jlab-go-air-pop-true-wireless-earbuds-slate/6472664";
  const m = reviewsUrl.match(/\/site\/(?:reviews|questions)\/(.+?)\/(\d+)/);
  const productUrl = m
    ? `https://www.bestbuy.com/site/${m[1]}/${m[2]}.p`
    : reviewsUrl;

  // Probe A: the reviews page with render OFF — where the JSON-LD lives.
  await probe(nimble, "A · reviews page, render:false", reviewsUrl, {
    render: false,
    timeout: 30_000,
  });

  // Probe B: the canonical product page with render ON — the task's assumption.
  await probe(nimble, "B · product .p page, render:true", productUrl, {
    render: true,
    timeout: 30_000,
  });
}

main().catch((err) => {
  console.error("test:bestbuy failed:", err);
  process.exit(1);
});
