"use client";

import { useEffect, useState } from "react";

/* ----------------------------- types ----------------------------- */

interface EnrichedData {
  realPrice: string | null;
  wasPrice: string | null;
  isPriceReduced: boolean;
  sellerName: string | null;
  brand: string | null;
  inStock: boolean;
  averageRating: number | null;
  totalReviews: number | null;
  reviewsWithText: number | null;
  recommendedPercent: number | null;
  ratingDistribution: {
    stars5: number;
    stars4: number;
    stars3: number;
    stars2: number;
    stars1: number;
  } | null;
}

interface DealCandidate {
  title: string;
  price: string;
  oldPrice: string | null;
  merchant: string;
  thumbnailUrl: string | null;
  isOnSale: boolean;
  sourceUrl: string | null;
  enrichment?: EnrichedData;
}

interface InvestigationResult {
  candidate: DealCandidate;
  trustScore: number;
  flags: string[];
  verdict: "trusted" | "trap";
  evidence: string[];
}

interface SiftResult {
  query: string;
  totalChecked: number;
  traps: InvestigationResult[];
  trusted: InvestigationResult[];
}

type Phase = "hero" | "loading" | "reveal" | "error";

/* --------------------------- investigation stages --------------------------- */

const STAGES = [
  "Searching the web",
  "Scanning shopping results",
  "Investigating each deal",
  "Cross-referencing prices",
  "Checking merchant trust",
  "Exposing the fakes",
] as const;

const STAGE_MS = 720;

/* ------------------------------- helpers ------------------------------- */

function parsePrice(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
}

function savingsPercent(price: string, oldPrice: string | null): number | null {
  const now = parsePrice(price);
  const was = parsePrice(oldPrice);
  if (now === null || was === null || was <= now) return null;
  return Math.round(((was - now) / was) * 100);
}

/* ================================ page ================================ */

export default function Home() {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("hero");
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<SiftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Advance the fake investigation stages while the real request runs.
  useEffect(() => {
    if (phase !== "loading") return;
    const id = setInterval(() => {
      setStage((s) => (s < STAGES.length - 1 ? s + 1 : s));
    }, STAGE_MS);
    return () => clearInterval(id);
  }, [phase]);

  // Reveal only once BOTH the staged animation has completed and data arrived.
  useEffect(() => {
    if (phase !== "loading") return;
    if (result && stage >= STAGES.length - 1) {
      const id = setTimeout(() => setPhase("reveal"), 450);
      return () => clearTimeout(id);
    }
  }, [phase, result, stage]);

  async function siftIt() {
    const q = query.trim();
    if (!q || phase === "loading") return;

    setPhase("loading");
    setStage(0);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/api/sift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || `HTTP ${res.status}`);
      }
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhase("error");
    }
  }

  function reset() {
    setPhase("hero");
    setResult(null);
    setError(null);
    setStage(0);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
      {/* ambient backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.08),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:44px_44px]" />

      <div className="relative mx-auto max-w-6xl px-6">
        {phase === "hero" && (
          <Hero
            query={query}
            setQuery={setQuery}
            onSubmit={siftIt}
          />
        )}

        {phase === "loading" && (
          <LoadingPanel stage={stage} candidateCount={result?.totalChecked} />
        )}

        {phase === "error" && <ErrorPanel error={error} onRetry={reset} />}

        {phase === "reveal" && result && (
          <Reveal result={result} onReset={reset} />
        )}
      </div>
    </main>
  );
}

/* ================================ hero ================================ */

function Hero({
  query,
  setQuery,
  onSubmit,
}: {
  query: string;
  setQuery: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center py-20 text-center">
      <div className="animate-fade-in-up">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-zinc-400">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
          onlythebest.deals
        </div>

        <h1 className="text-6xl font-extrabold tracking-tight sm:text-8xl">
          Sift<span className="text-emerald-400">.</span>
        </h1>

        <p className="mx-auto mt-5 max-w-xl text-balance text-lg text-zinc-400 sm:text-xl">
          We don&apos;t find deals.{" "}
          <span className="font-semibold text-zinc-100">
            We kill the fake ones.
          </span>
        </p>
      </div>

      <div className="mt-10 w-full max-w-xl animate-fade-in-up anim-delay-200 opacity-0">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/80 p-2 shadow-2xl shadow-emerald-500/5 backdrop-blur transition focus-within:border-emerald-500/60">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onSubmit()}
            placeholder="What are you looking for?"
            className="flex-1 bg-transparent px-4 py-3 text-base text-zinc-100 placeholder-zinc-600 outline-none"
          />
          <button
            onClick={onSubmit}
            disabled={!query.trim()}
            className="rounded-lg bg-emerald-500 px-6 py-3 text-sm font-bold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sift it
          </button>
        </div>
        <p className="mt-4 font-mono text-xs text-zinc-600">
          so only the real ones remain.
        </p>
      </div>
    </section>
  );
}

/* ============================== loading ============================== */

function LoadingPanel({
  stage,
  candidateCount,
}: {
  stage: number;
  candidateCount?: number;
}) {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center py-20">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-xs uppercase tracking-[0.25em] text-emerald-400">
            Investigation live
          </span>
        </div>

        {/* scan frame */}
        <div className="relative mb-8 h-1 overflow-hidden rounded-full bg-zinc-900">
          <div className="absolute inset-y-0 left-0 w-1/3 animate-scan-line rounded-full bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />
        </div>

        <ul className="space-y-3 font-mono text-sm">
          {STAGES.map((label, i) => {
            const done = i < stage;
            const active = i === stage;
            const text =
              i === 1 && candidateCount !== undefined
                ? `Found ${candidateCount} candidates`
                : label;
            return (
              <li
                key={label}
                className={`flex items-center gap-3 transition-colors duration-300 ${
                  done
                    ? "text-zinc-500"
                    : active
                      ? "text-zinc-100"
                      : "text-zinc-700"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                    done
                      ? "border-emerald-600 bg-emerald-600/20 text-emerald-400"
                      : active
                        ? "border-emerald-500 text-emerald-400"
                        : "border-zinc-800 text-transparent"
                  }`}
                >
                  {done ? "✓" : active ? "" : ""}
                  {active && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse-dot" />
                  )}
                </span>
                <span>
                  {text}
                  {active && <Ellipsis />}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Ellipsis() {
  const [dots, setDots] = useState("");
  useEffect(() => {
    const id = setInterval(
      () => setDots((d) => (d.length >= 3 ? "" : d + ".")),
      300,
    );
    return () => clearInterval(id);
  }, []);
  return <span className="text-emerald-400">{dots}</span>;
}

/* =============================== error =============================== */

function ErrorPanel({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="flex min-h-screen flex-col items-center justify-center py-20 text-center">
      <div className="max-w-md animate-fade-in-up rounded-xl border border-red-900/60 bg-red-950/20 p-8">
        <div className="font-mono text-xs uppercase tracking-widest text-red-400">
          Investigation failed
        </div>
        <p className="mt-3 text-sm text-zinc-300">
          {error ?? "Something went wrong."}
        </p>
        <button
          onClick={onRetry}
          className="mt-6 rounded-lg border border-zinc-700 px-5 py-2 text-sm font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
        >
          Try again
        </button>
      </div>
    </section>
  );
}

/* ============================== reveal ============================== */

function Reveal({
  result,
  onReset,
}: {
  result: SiftResult;
  onReset: () => void;
}) {
  const { totalChecked, traps, trusted } = result;

  return (
    <section className="py-16 sm:py-24">
      {/* shock line */}
      <header className="animate-fade-in-up text-center">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-zinc-500">
          Investigation complete — “{result.query}”
        </div>
        <h2 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight sm:text-6xl">
          Checked {totalChecked} deals.
          <br />
          <span className="text-red-500">{traps.length} are traps.</span>
        </h2>
        <p className="mt-4 text-xl text-zinc-400 sm:text-2xl">
          <span className="font-bold text-emerald-400">{trusted.length}</span>{" "}
          you can trust.
        </p>
      </header>

      {totalChecked === 0 && (
        <p className="mt-12 text-center font-mono text-sm text-zinc-500">
          No shopping deals surfaced for that search. Try another query.
        </p>
      )}

      {/* the trap wall */}
      {traps.length > 0 && (
        <div className="mt-16">
          <SectionLabel
            color="red"
            title="The trap wall"
            subtitle={`${traps.length} deals we rejected`}
          />
          <div className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {traps.map((r, i) => (
              <TrapCard key={i} result={r} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* the trusted shortlist */}
      {trusted.length > 0 && (
        <div className="mt-20 animate-slide-up opacity-0" style={{ animationDelay: "250ms" }}>
          <SectionLabel
            color="emerald"
            title="The trusted shortlist"
            subtitle={`${trusted.length} that survived`}
          />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {trusted.map((r, i) => (
              <TrustedCard key={i} result={r} index={i} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-20 flex justify-center">
        <button
          onClick={onReset}
          className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-6 py-3 text-sm font-semibold text-zinc-200 transition hover:border-emerald-500/60 hover:text-emerald-300"
        >
          ↺ Search again
        </button>
      </div>

      <p className="mt-10 text-center font-mono text-xs text-zinc-700">
        onlythebest.deals — curation by exclusion
      </p>
    </section>
  );
}

function SectionLabel({
  color,
  title,
  subtitle,
}: {
  color: "red" | "emerald";
  title: string;
  subtitle: string;
}) {
  const dot = color === "red" ? "bg-red-500" : "bg-emerald-500";
  const text = color === "red" ? "text-red-400" : "text-emerald-400";
  return (
    <div className="flex items-baseline gap-3 border-b border-zinc-800 pb-3">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      <h3 className={`text-sm font-bold uppercase tracking-widest ${text}`}>
        {title}
      </h3>
      <span className="font-mono text-xs text-zinc-600">{subtitle}</span>
    </div>
  );
}

/* ------------------------------ trap card ------------------------------ */

function TrapCard({
  result,
  index,
}: {
  result: InvestigationResult;
  index: number;
}) {
  const { candidate, flags } = result;
  return (
    <article
      className="group relative animate-fade-in-up overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/40 p-3 opacity-0 grayscale transition-all duration-300 hover:z-20 hover:scale-105 hover:grayscale-0 hover:border-red-900/60"
      style={{ animationDelay: `${Math.min(index, 14) * 45}ms` }}
    >
      {/* TRAP stamp */}
      <div className="pointer-events-none absolute right-2 top-2 z-10 animate-stamp-in rounded border border-red-600/80 px-1 py-px font-mono text-[8px] font-black uppercase tracking-widest text-red-500/90">
        Trap
      </div>

      <h4 className="truncate pr-10 text-xs font-semibold text-zinc-400">
        {candidate.title}
      </h4>

      <div className="mt-1.5 flex items-center gap-1.5 font-mono text-[10px] text-zinc-600">
        <span className="text-zinc-400">{candidate.price || "—"}</span>
        <span>·</span>
        <span className="truncate">{candidate.merchant || "unknown"}</span>
      </div>

      {/* hover overlay: flags in red */}
      {flags.length > 0 && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-end gap-1 bg-gradient-to-t from-red-950/95 via-red-950/80 to-transparent p-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          <ul className="space-y-1">
            {flags.map((flag, i) => (
              <li
                key={i}
                className="flex gap-1 text-[10px] leading-snug text-red-300"
              >
                <span className="text-red-500">⚑</span>
                <span>{flag}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/* ----------------------------- trusted card ----------------------------- */

function TrustedCard({
  result,
  index,
}: {
  result: InvestigationResult;
  index: number;
}) {
  const { candidate, trustScore, evidence } = result;
  const savings = savingsPercent(candidate.price, candidate.oldPrice);
  const { enrichment } = candidate;
  // The "VERIFIED DATA:" bullet is replaced by the structured report below,
  // so drop it from the regular evidence list to avoid showing it twice.
  const otherEvidence = evidence.filter(
    (e) => !e.trimStart().startsWith("VERIFIED DATA:"),
  );

  return (
    <article
      className="group relative animate-fade-in-up overflow-hidden rounded-xl border border-emerald-900/50 bg-gradient-to-b from-emerald-950/30 to-zinc-900/60 p-5 opacity-0 shadow-lg shadow-emerald-500/5 transition hover:border-emerald-700/60 hover:shadow-emerald-500/10"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="absolute inset-y-0 left-0 w-1 bg-emerald-500/80" />

      <div className="flex items-start justify-between gap-4 pl-2">
        <h4 className="text-base font-semibold text-zinc-50">
          {candidate.title}
        </h4>
        {savings !== null && (
          <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-400">
            −{savings}%
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3 pl-2 font-mono">
        <span className="text-xl font-bold text-emerald-400">
          {candidate.price || "—"}
        </span>
        {candidate.oldPrice && (
          <span className="text-sm text-zinc-600 line-through">
            {candidate.oldPrice}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 pl-2 text-xs text-zinc-400">
        <span className="text-emerald-400">✓</span>
        <span>{candidate.merchant || "verified merchant"}</span>
      </div>

      {/* trust score bar */}
      <div className="mt-4 pl-2">
        <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          <span>Trust score</span>
          <span className="text-emerald-400">{trustScore}/100</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400"
            style={{ width: `${trustScore}%` }}
          />
        </div>
      </div>

      {enrichment && <VerifiedReport enrichment={enrichment} />}

      {otherEvidence.length > 0 && (
        <ul className="mt-4 space-y-1.5 pl-2">
          {otherEvidence.map((e, i) => (
            <li
              key={i}
              className="flex gap-2 text-xs leading-snug text-zinc-400"
            >
              <span className="mt-px text-[11px] font-bold text-emerald-400">✓</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/* --------------------------- verified-by-sift report --------------------------- */

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

  const hasPrice = realPrice !== null;
  const hasReviews = averageRating !== null && totalReviews !== null;

  return (
    <section className="mt-4 ml-2 rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-3">
      <div className="mb-2.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-400">
        <span>🔍</span>
        <span>Verified</span>
        <span className="text-emerald-700">— by Sift</span>
      </div>

      <div className="space-y-2 text-xs text-zinc-300">
        {/* real price */}
        {hasPrice && (
          <div className="flex items-baseline gap-2">
            <span className="font-mono font-semibold text-emerald-300">
              {realPrice}
            </span>
            {isPriceReduced && wasPrice ? (
              <span className="text-zinc-500">
                (was{" "}
                <span className="line-through">{wasPrice}</span>) — genuine sale{" "}
                <span className="text-emerald-400">✓</span>
              </span>
            ) : (
              <span className="text-zinc-500">— everyday price</span>
            )}
          </div>
        )}

        {/* seller */}
        {sellerName && (
          <div className="flex items-center gap-1.5">
            <span className="text-emerald-400">✓</span>
            <span>
              Sold by <span className="text-zinc-100">{sellerName}</span>{" "}
              <span className="text-zinc-500">(1st party)</span>
            </span>
          </div>
        )}

        {/* review summary */}
        {hasReviews && (
          <div className="flex items-center gap-2">
            <StarRating rating={averageRating!} />
            <span>
              <span className="font-semibold text-zinc-100">
                {averageRating!.toFixed(1)}★
              </span>{" "}
              <span className="text-zinc-500">
                from {totalReviews!.toLocaleString()} reviews
              </span>
            </span>
          </div>
        )}

        {/* review quality */}
        {(reviewsWithText !== null || recommendedPercent !== null) && (
          <div className="text-[11px] text-zinc-500">
            {reviewsWithText !== null && (
              <span>{reviewsWithText.toLocaleString()} written reviews</span>
            )}
            {reviewsWithText !== null && recommendedPercent !== null && (
              <span> · </span>
            )}
            {recommendedPercent !== null && (
              <span>{recommendedPercent}% recommended</span>
            )}
          </div>
        )}

        {/* rating distribution */}
        {ratingDistribution && <RatingBar dist={ratingDistribution} />}
      </div>
    </section>
  );
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span className="font-mono text-xs leading-none" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className={i < Math.round(rating) ? "text-amber-400" : "text-zinc-700"}
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

  const segments = [
    { count: dist.stars5, color: "bg-emerald-500", label: "5★" },
    { count: dist.stars4, color: "bg-emerald-600", label: "4★" },
    { count: dist.stars3, color: "bg-amber-500", label: "3★" },
    { count: dist.stars2, color: "bg-red-500", label: "2★" },
    { count: dist.stars1, color: "bg-red-600", label: "1★" },
  ];

  return (
    <div
      className="flex h-1.5 overflow-hidden rounded-full bg-zinc-800"
      title={segments.map((s) => `${s.label}: ${s.count}`).join("  ")}
    >
      {segments.map(
        (s) =>
          s.count > 0 && (
            <div
              key={s.label}
              className={s.color}
              style={{ width: `${(s.count / total) * 100}%` }}
            />
          ),
      )}
    </div>
  );
}
