"use client";

/**
 * Sift — Act 3: Results (verdict + trusted shortlist + trap wall).
 *
 * Ported from the Claude Design prototype (claude-design/src/Results.jsx) and
 * driven by a real SiftResult. The prototype's mock fields are derived from the
 * live investigation data (see the map* helpers below). Trusted cards that carry
 * Nimble-extracted `enrichment` also render a "Verified by Sift" report.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { CountUp, Key, Meter } from "./primitives";
import type {
  DealCandidate,
  EnrichedData,
  InvestigationResult,
  SiftResult,
} from "@/lib/types";

interface ResultsProps {
  query: string;
  result: SiftResult;
  onReset: () => void;
}

/* ------------------------------ label maps ------------------------------ */

const VERDICT_LABEL: Record<string, string> = {
  price: "PRICE BAIT",
  reviews: "FAKE REVIEWS",
  seller: "GHOST SELLER",
  images: "STOLEN PHOTOS",
  spec: "SPEC LIE",
  returns: "NO RECOURSE",
  ghost: "NO ENTITY",
  bait: "BAIT & SWITCH",
  rating: "RIGGED RATING",
};

type FactorKey = "seller" | "reviews" | "price" | "spec";
type Factors = Record<FactorKey, number>;
const FACTOR_LABEL: Record<FactorKey, string> = {
  seller: "Seller",
  reviews: "Reviews",
  price: "Price",
  spec: "Specs",
};

/** Retailers/brands trusted enough to lift the "seller" factor. */
const KNOWN =
  /amazon|walmart|best ?buy|target|costco|anker|sony|bose|jlab|skullcandy|soundcore|samsung|apple|earfun|1more|qcy/i;

/* ------------------------------- helpers -------------------------------- */

/** Pull the first numeric figure out of a price string ("$24.99" -> 24.99). */
function parsePrice(value: string | null | undefined): number {
  if (!value) return 0;
  const m = value.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}

/** A short brand label — the title's first word, falling back to the merchant. */
function brandFrom(c: DealCandidate): string {
  const first = c.title.trim().split(/\s+/)[0];
  return first || c.merchant.trim() || "—";
}

/**
 * Trusted-card spec chips. From real extracted data when present (rating, review
 * count, seller), otherwise the first couple of evidence flags, otherwise empty.
 */
function specsFrom(item: InvestigationResult): string[] {
  const e = item.candidate.enrichment;
  if (!e) return item.flags.slice(0, 3);
  const out: string[] = [];
  if (e.averageRating !== null) out.push(`Rating: ${e.averageRating.toFixed(1)}/5`);
  if (e.totalReviews !== null) out.push(`${e.totalReviews.toLocaleString()} reviews`);
  if (e.sellerName) out.push(`${e.sellerName} 1P`);
  else if (item.candidate.merchant) out.push(`${item.candidate.merchant} 1P`);
  return out;
}

/** Factor bar scores, derived from extracted data. Null when not enriched. */
function factorsFrom(item: InvestigationResult): Factors | null {
  const e = item.candidate.enrichment;
  if (!e) return null;
  const seller = e.sellerName && KNOWN.test(e.sellerName) ? 90 : 60;
  const reviews =
    e.totalReviews !== null
      ? Math.round(Math.min(99, (e.totalReviews / 500) * 10 + 50))
      : 50;
  const price = e.isPriceReduced ? 90 : 70;
  const spec = item.trustScore;
  return { seller, reviews, price, spec };
}

/** Map a flag string to a verdict category key via keyword matching. */
function primaryFromFlag(flag: string): string {
  const f = flag.toLowerCase();
  if (/price|markup|aliexpress/.test(f)) return "price";
  if (/review/.test(f)) return "reviews";
  if (/seller|merchant|unknown/.test(f)) return "seller";
  if (/keyword|spam|stuffed/.test(f)) return "spec";
  if (/dropship/.test(f)) return "ghost";
  if (/discount|sale/.test(f)) return "bait";
  return "price";
}

/* --------------------------- verified report ---------------------------- */

function Stars({ rating }: { rating: number }) {
  return (
    <span
      aria-hidden
      style={{ fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1 }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{
            color: i < Math.round(rating) ? "var(--accent)" : "var(--ghost)",
          }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function RatingBar({
  dist,
}: {
  dist: NonNullable<EnrichedData["ratingDistribution"]>;
}) {
  const total =
    dist.stars5 + dist.stars4 + dist.stars3 + dist.stars2 + dist.stars1;
  if (total === 0) return null;
  const segs = [
    { count: dist.stars5, color: "var(--accent)", label: "5★" },
    {
      count: dist.stars4,
      color: "color-mix(in srgb, var(--accent) 55%, var(--bg-3))",
      label: "4★",
    },
    { count: dist.stars3, color: "var(--dim)", label: "3★" },
    { count: dist.stars2, color: "var(--faint)", label: "2★" },
    { count: dist.stars1, color: "var(--ghost)", label: "1★" },
  ];
  return (
    <div
      title={segs.map((s) => `${s.label}: ${s.count}`).join("  ")}
      style={{
        display: "flex",
        height: 6,
        overflow: "hidden",
        borderRadius: 99,
        background: "var(--bg-3)",
      }}
    >
      {segs.map(
        (s) =>
          s.count > 0 && (
            <div
              key={s.label}
              style={{ width: `${(s.count / total) * 100}%`, background: s.color }}
            />
          ),
      )}
    </div>
  );
}

/** The "Verified by Sift" block — real on-page facts from Nimble Extract. */
function VerifiedReport({ enrichment }: { enrichment: EnrichedData }) {
  const {
    realPrice,
    wasPrice,
    isPriceReduced,
    sellerName,
    averageRating,
    totalReviews,
    reviewsWithText,
    recommendedPercent,
    ratingDistribution,
  } = enrichment;

  const hasReviews = averageRating !== null && totalReviews !== null;

  return (
    <div
      style={{
        marginTop: 14,
        padding: "12px 14px",
        borderRadius: 10,
        border: "1px solid var(--line)",
        background: "var(--bg-1)",
        display: "flex",
        flexDirection: "column",
        gap: 9,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: "var(--dim)",
      }}
    >
      <div
        style={{
          fontSize: 9.5,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--faint)",
        }}
      >
        🔍 verified by sift
      </div>

      {realPrice !== null && (
        <div>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>
            {realPrice}
          </span>{" "}
          {isPriceReduced && wasPrice ? (
            <span>
              was{" "}
              <span
                style={{ textDecoration: "line-through", color: "var(--ghost)" }}
              >
                {wasPrice}
              </span>{" "}
              — genuine sale <span style={{ color: "var(--accent)" }}>✓</span>
            </span>
          ) : (
            <span>— everyday price</span>
          )}
        </div>
      )}

      {sellerName && (
        <div>
          <span style={{ color: "var(--accent)" }}>✓</span> Sold by{" "}
          <span style={{ color: "var(--text)" }}>{sellerName}</span>{" "}
          <span style={{ color: "var(--faint)" }}>(1st party)</span>
        </div>
      )}

      {hasReviews && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Stars rating={averageRating} />
          <span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>
              {averageRating.toFixed(1)}★
            </span>{" "}
            from {totalReviews.toLocaleString()} reviews
          </span>
        </div>
      )}

      {(reviewsWithText !== null || recommendedPercent !== null) && (
        <div style={{ color: "var(--faint)", fontSize: 11 }}>
          {reviewsWithText !== null && (
            <span>{reviewsWithText.toLocaleString()} written</span>
          )}
          {reviewsWithText !== null && recommendedPercent !== null && (
            <span> · </span>
          )}
          {recommendedPercent !== null && (
            <span>{recommendedPercent}% recommended</span>
          )}
        </div>
      )}

      {ratingDistribution && <RatingBar dist={ratingDistribution} />}
    </div>
  );
}

/* ----------------------------- trusted card ----------------------------- */

function TrustedCard({
  item,
  index,
  selected,
  onSelect,
  cardRef,
}: {
  item: InvestigationResult;
  index: number;
  selected: boolean;
  onSelect: () => void;
  cardRef: (el: HTMLElement | null) => void;
}) {
  const c = item.candidate;
  const price = parsePrice(c.price);
  const wasRaw = parsePrice(c.oldPrice);
  const was = wasRaw > price ? wasRaw : price;
  const specs = specsFrom(item);
  const factors = factorsFrom(item);
  // The structured VerifiedReport renders the extracted data, so drop the raw
  // "VERIFIED DATA:" evidence bullet from the one-line note to avoid duplication.
  const note = item.evidence
    .filter((e) => !e.trimStart().startsWith("VERIFIED DATA:"))
    .join(" · ");

  return (
    <article
      ref={cardRef}
      className={"tcard" + (selected ? " sel" : "")}
      style={{ animationDelay: index * 70 + "ms" }}
      onMouseEnter={onSelect}
      onClick={onSelect}
    >
      <div className="tcard__top">
        <div>
          <div className="tcard__brand">{brandFrom(c)}</div>
          <div className="tcard__model">{c.title}</div>
          {specs.length > 0 && (
            <div className="tcard__specs">
              {specs.map((s) => (
                <span key={s}>{s}</span>
              ))}
            </div>
          )}
        </div>
        <div className="tcard__score">
          <div className="v tnum">
            <CountUp to={item.trustScore} dur={1100} delay={index * 70 + 200} />
            <span className="max">/100</span>
          </div>
          <div className="lbl">trust</div>
        </div>
      </div>

      <div className="tcard__underline">
        <Meter value={item.trustScore} delay={index * 70 + 250} />
      </div>

      <div className="tcard__divider" />
      {note && <div className="tcard__note">{note}</div>}

      {selected && factors && (
        <div className="tcard__factors">
          {(Object.keys(factors) as FactorKey[]).map((k) => (
            <div className="factor" key={k}>
              <div className="fl">
                <b>{FACTOR_LABEL[k]}</b>
                <span className="tnum">{factors[k]}</span>
              </div>
              <Meter value={factors[k]} delay={60} dur={700} />
            </div>
          ))}
        </div>
      )}

      {c.enrichment && <VerifiedReport enrichment={c.enrichment} />}

      <div className="tcard__foot">
        <div className="tcard__price tnum">
          ${price.toFixed(2)}
          {was > price && <span className="was">${was.toFixed(2)}</span>}
        </div>
      </div>
    </article>
  );
}

/* -------------------------------- trap ---------------------------------- */

function Trap({ item, index }: { item: InvestigationResult; index: number }) {
  const c = item.candidate;
  const price = parsePrice(c.price);
  const flags = item.flags;
  const primary = flags.length ? primaryFromFlag(flags[0]) : "price";
  const firstFlag = flags[0] ?? "Flagged by investigation";

  return (
    <div className="trap" style={{ animationDelay: 120 + index * 28 + "ms" }}>
      <div className="trap__name">{c.title}</div>
      <div className="trap__row">
        <span className="trap__price tnum">${price.toFixed(2)}</span>
        <span className="trap__verdict">{VERDICT_LABEL[primary] ?? "FLAGGED"}</span>
      </div>
      <div className="trap__primary">
        <span className="mk">✕</span>
        {firstFlag}
      </div>

      <div className="trap__sheet">
        <div className="sh-title">
          <span>rap sheet</span>
          <span>{flags.length} flags</span>
        </div>
        <ul>
          {flags.map((f, i) => (
            <li key={i}>
              <span className="i">✕</span>
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------- results -------------------------------- */

export function Results({ query, result, onReset }: ResultsProps) {
  const [selIndex, setSelIndex] = useState(0);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const { trusted, traps, totalChecked } = result;

  const scrollToCard = useCallback((i: number) => {
    const el = cardRefs.current[i];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const absTop = rect.top + window.scrollY;
    const target = absTop - (window.innerHeight / 2 - rect.height / 2);
    window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, []);

  // Keyboard navigation across the trusted shortlist.
  useEffect(() => {
    const n = trusted.length;
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "Escape") {
        e.preventDefault();
        onReset();
        return;
      }
      if (k === "ArrowDown" || k === "j") {
        e.preventDefault();
        setSelIndex((i) => {
          const ni = Math.min(n - 1, i + 1);
          scrollToCard(ni);
          return ni;
        });
      } else if (k === "ArrowUp" || k === "k") {
        e.preventDefault();
        setSelIndex((i) => {
          const ni = Math.max(0, i - 1);
          scrollToCard(ni);
          return ni;
        });
      } else if (k === "ArrowRight") {
        e.preventDefault();
        setSelIndex((i) => {
          const ni = Math.min(n - 1, i + 2);
          scrollToCard(ni);
          return ni;
        });
      } else if (k === "ArrowLeft") {
        e.preventDefault();
        setSelIndex((i) => {
          const ni = Math.max(0, i - 2);
          scrollToCard(ni);
          return ni;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trusted.length, onReset, scrollToCard]);

  return (
    <div className="results">
      {/* verdict */}
      <div className="verdict">
        <div className="verdict__head">
          <div className="eyebrow">verdict</div>
          <h2>
            <CountUp to={trusted.length} dur={1200} /> worth buying.
            <br />
            <em>
              <CountUp to={traps.length} dur={1400} /> killed.
            </em>
          </h2>
          <div className="verdict__q mono">
            › query <span className="ul">&quot;{query}&quot;</span>
          </div>
        </div>
        <div className="verdict__ratio">
          <div className="ratio-cell">
            <div className="n tnum">
              <CountUp to={totalChecked} dur={1100} />
            </div>
            <div className="l eyebrow">examined</div>
          </div>
          <div className="ratio-cell">
            <div className="n dim tnum">
              <CountUp to={traps.length} dur={1300} />
            </div>
            <div className="l eyebrow">traps</div>
          </div>
          <div className="ratio-cell">
            <div className="n acc tnum">
              <CountUp to={trusted.length} dur={1500} />
            </div>
            <div className="l eyebrow">trusted</div>
          </div>
        </div>
      </div>

      {/* trusted */}
      {trusted.length > 0 && (
        <>
          <div className="sec-head">
            <div className="sec-head__l">
              <h3>Cleared to buy</h3>
              <span className="num mono">{trusted.length} survived</span>
            </div>
            <div className="sec-head__hint">
              <Key>↑</Key>
              <Key>↓</Key> navigate · <Key>↵</Key> evidence
            </div>
          </div>
          <div className="trusted-grid">
            {trusted.map((item, i) => (
              <TrustedCard
                key={i}
                item={item}
                index={i}
                selected={selIndex === i}
                onSelect={() => setSelIndex(i)}
                cardRef={(el) => {
                  cardRefs.current[i] = el;
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* trap wall */}
      {traps.length > 0 && (
        <>
          <div className="sec-head">
            <div className="sec-head__l">
              <h3>The evidence room</h3>
              <span className="num mono">
                {traps.length.toLocaleString()} eliminated
              </span>
            </div>
            <div className="sec-head__hint">hover a tile for its rap sheet</div>
          </div>
          <div className="trap-wall">
            {traps.map((item, i) => (
              <Trap key={i} item={item} index={i} />
            ))}
          </div>
        </>
      )}

      {totalChecked === 0 && (
        <p className="sec-head__hint" style={{ marginTop: 48 }}>
          No deals surfaced for that search. Try another query.
        </p>
      )}

      <div className="results__foot">
        <div className="eyebrow">sift · curation by exclusion</div>
        <button className="btn-ghost" onClick={onReset}>
          run a new investigation <Key wide>esc</Key>
        </button>
      </div>
    </div>
  );
}
