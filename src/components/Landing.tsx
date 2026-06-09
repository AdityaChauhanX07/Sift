"use client";

/**
 * Sift — Act 1: Landing.
 *
 * Ported from the Claude Design prototype (claude-design/src/Landing.jsx) to
 * TypeScript. All data is local (props or the constants below) — no window.SIFT.
 * The hero stats are aspirational demo totals shown before any query runs; the
 * real per-query numbers appear in the Results view after an investigation.
 */
import { type RefObject } from "react";
import { CountUp, Key, Ticker } from "./primitives";

interface LandingProps {
  query: string;
  setQuery: (q: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement>;
}

/** Example queries offered on the landing command line. */
const SUGGESTIONS: string[] = [
  "wireless earbuds under $50",
  "mechanical keyboard hot-swap",
  "portable ssd 2tb",
  "espresso machine under $300",
  "running shoes neutral",
];

/** Aspirational hero totals (pre-query demo numbers, not a real result). */
const TOTALS = { examined: 1284, traps: 1247, trusted: 37 };

/** One scrolling "recently killed" ticker entry. */
interface KilledItem {
  name: string;
  price: number;
  reason: string;
}

/** Sample trap listings for the landing ticker, mirroring the mock data. */
const KILLED: KilledItem[] = [
  { name: "HXSJ Pro Max Wireless Earbuds 5.4 ANC TWS Sport", price: 6.99, reason: "Priced 8.7× below category median" },
  { name: "TOZO-Style A1 Bluetooth Earbuds 2024 NEW LED", price: 4.5, reason: "1890 reviews in 9 days — manufactured" },
  { name: "Boqiy 40H Playtime LED Display Earphones HiFi", price: 8.99, reason: "Claims exceed the chipset's hardware ceiling" },
  { name: "Wireless Earbuds Bluetooth 5.3 Headphones Mini", price: 5.49, reason: "Brand has no traceable legal entity" },
  { name: "JUSHENG i7s TWS Touch Control Earbuds Stereo", price: 3.99, reason: "Listed price is for the case, not the buds" },
  { name: "Pro 6 Earbuds ANC Noise Cancelling 2024 Upgrade", price: 7.25, reason: "Priced 7.4× below category median" },
  { name: "Air 4 Pro Wireless Charging Case Pop-up Pairing", price: 9.99, reason: "Claims exceed the chipset's hardware ceiling" },
  { name: "Bmani Bluetooth Earbuds 60H IPX7 Waterproof Sport", price: 6.5, reason: "Seller registered 6 days ago" },
  { name: "M10 TWS Gaming Low Latency Earbuds RGB Display", price: 8.25, reason: "2780 reviews in 17 days — manufactured" },
  { name: "Wireless Earphones Noise Reduction Touch Sensor", price: 5.99, reason: "Photos reused across 73 other listings" },
];

export function Landing({ query, setQuery, onSubmit, inputRef }: LandingProps) {
  return (
    <div className="land">
      <div className="land__manifesto">
        <div className="land__kicker eyebrow">
          <span className="pulse" />
          curation by exclusion
        </div>

        <h1>
          <span className="line">
            <span>We don&apos;t rank results.</span>
          </span>
          <span className="line">
            <span>
              We <em>kill</em> the <span className="strike">fakes</span>.
            </span>
          </span>
        </h1>

        <p className="land__sub">
          Sift investigates every listing for your query, eliminates the traps —
          fake reviews, ghost sellers, drop-ship markups — and shows you only the
          few worth buying.
        </p>
      </div>

      <div
        className="cmd"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit();
          }
        }}
      >
        <div className="cmd__box">
          <span className="cmd__chev mono">›</span>
          <input
            ref={inputRef}
            className="cmd__input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="what are you trying to buy?"
            spellCheck="false"
            autoComplete="off"
          />
          <button type="button" className="cmd__go" onClick={onSubmit}>
            <span className="lbl">Investigate</span>
            <Key>↵</Key>
          </button>
        </div>

        <div className="cmd__hints">
          {SUGGESTIONS.map((s) => (
            <button
              type="button"
              key={s}
              className="chip"
              onClick={() => {
                setQuery(s);
                window.setTimeout(onSubmit, 60);
              }}
            >
              <span className="chip__q mono">›</span>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="land__stats">
        <div className="land__stat">
          <div className="n tnum">
            <CountUp to={TOTALS.examined} dur={1400} delay={900} />
          </div>
          <div className="l eyebrow">listings examined</div>
        </div>
        <div className="land__stat">
          <div className="n killed tnum">
            <CountUp to={TOTALS.traps} dur={1500} delay={1000} />
          </div>
          <div className="l eyebrow">traps eliminated</div>
        </div>
        <div className="land__stat">
          <div className="n kept tnum">
            <CountUp to={TOTALS.trusted} dur={1600} delay={1100} />
          </div>
          <div className="l eyebrow">cleared to buy</div>
        </div>
      </div>

      <div className="land__ticker">
        <Ticker
          items={KILLED}
          speed={64}
          render={(it) => (
            <span className="killitem">
              <span className="x">✕</span>
              <span className="nm">{it.name}</span>
              <span className="pr">${it.price.toFixed(2)}</span>
              <span className="sep">·</span>
              <span className="rs">{it.reason}</span>
            </span>
          )}
        />
      </div>
    </div>
  );
}
