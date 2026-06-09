# Sift

**We don't find deals. We kill the fake ones.**

Sift is a deal trust agent. You tell it what you're looking for, and it investigates every deal it can find across the web. Most of them are traps: dropshipped junk from AliExpress with fake markups, keyword-stuffed listings from unknown sellers, "sales" that aren't actually sales. Sift finds all of that, exposes it, and shows you only the deals that survive.

Built for the DeveloperWeek New York 2026 Hackathon. Domain: [onlythebest.deals](https://onlythebest.deals)

## The problem

Search for "wireless earbuds under $50" and you'll get 30+ results. Most of them look legit. Star ratings, sale badges, "limited time" urgency. But dig in and you'll find:

- The $2.44 "Bluetooth 5.3 Stereo Bass Sports Headphones" from WJyouxuan is the same $0.80 product on AliExpress with a 3x markup
- The $5.00 earbuds at Target have zero verified reviews
- Half the "sales" are regular prices with a fake original price slapped on

Nobody has time to investigate 30 listings one by one. So people either buy the trap or just default to whatever Amazon recommends.

## What Sift does

1. You type what you're looking for ("wireless earbuds under $50")
2. Sift searches the web and finds ~20-35 candidates via Nimble's SERP API
3. For each suspicious listing, it searches AliExpress to check if the same product exists at wholesale price
4. For candidates from Walmart and Best Buy, it extracts the real product page to verify: actual price, seller identity, review count, rating distribution, whether the sale is genuine
5. All of this feeds into an LLM that classifies every deal as "trusted" or "trap" with specific evidence
6. You see the result: "Checked 20 deals. 13 are traps. 7 you can trust."

The trap wall shows everything we rejected, with flags on hover. The trusted shortlist shows what survived, with verified evidence from the actual product pages.

## How it uses Nimble

Sift uses Nimble across the entire investigation pipeline, not just for one search:

- **SERP API** (google_search, parse:true) to find shopping candidates + organic review site context
- **SERP API** (site:aliexpress.com) to find source matches for suspected dropship products
- **Web API** (Extract) to scrape real product data from Walmart and Best Buy product pages: verified price, seller name, review counts, rating distributions

The investigation panel streams all of this live so you can watch Nimble working in real time.

## Tech stack

- **Next.js 14** (App Router) + custom CSS
- **Nimble** SERP + Web APIs for all web data
- **Groq** (Llama 3.3 70B) for deal classification
- TypeScript, streaming NDJSON for the live investigation panel

## Running it locally

```bash
git clone https://github.com/AdityaChauhan07/sift.git
cd sift
npm install
```

Create `.env.local`:
```
NIMBLE_USERNAME=your_nimble_username
NIMBLE_PASSWORD=your_nimble_password
GROQ_API_KEY=your_groq_key
```

```bash
npm run dev
```

The golden demo query ("wireless earbuds under $50") is pre-cached so it works instantly without any API keys. Live queries need valid Nimble and Groq credentials.

## The concept

The domain is onlythebest.deals. The only way to show "only the best deals" is to investigate all of them and expose the ones that aren't real. Curation by exclusion.

This is the opposite of how deal sites work today. They show you everything and call it a "deal" because there's a sale badge. Sift shows you less, because it killed the fakes first.

The same investigation engine could be licensed to marketplaces to cut chargebacks, or to payment providers for transaction risk scoring. But for now, it's a consumer tool: type what you want, see what you can actually trust.

---

Hackathon entry for DeveloperWeek NY 2026, submitted to the name.com Domain Roulette and Nimble challenges.