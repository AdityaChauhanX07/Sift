"use client";

import { useState } from "react";

interface DealCandidate {
  title: string;
  price: string;
  oldPrice: string | null;
  merchant: string;
  thumbnailUrl: string | null;
  isOnSale: boolean;
  sourceUrl: string | null;
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

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SiftResult | null>(null);

  async function siftIt() {
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);

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
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 font-mono">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight">
            sift<span className="text-emerald-400">_</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            deal trust agent — separating real deals from traps
          </p>
        </header>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && siftIt()}
            placeholder="wireless earbuds under $50"
            className="flex-1 rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-emerald-500"
          />
          <button
            onClick={siftIt}
            disabled={loading || !query.trim()}
            className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "investigating…" : "Sift it"}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {result && <Results result={result} />}
      </div>
    </main>
  );
}

function Results({ result }: { result: SiftResult }) {
  const { totalChecked, traps, trusted } = result;

  if (totalChecked === 0) {
    return (
      <p className="mt-10 text-sm text-zinc-500">
        No shopping deals found for “{result.query}”. Try a different query.
      </p>
    );
  }

  return (
    <>
      <div className="mt-10 border-y border-zinc-800 py-6 text-lg leading-relaxed">
        Checked <span className="font-bold text-zinc-100">{totalChecked}</span>{" "}
        deals.{" "}
        <span className="font-bold text-red-400">{traps.length}</span>{" "}
        {traps.length === 1 ? "is a trap" : "are traps"}.{" "}
        <span className="font-bold text-emerald-400">{trusted.length}</span> you
        can trust.
      </div>

      {traps.length > 0 && (
        <Section
          label="Traps"
          accent="red"
          count={traps.length}
          results={traps}
        />
      )}
      {trusted.length > 0 && (
        <Section
          label="Trusted"
          accent="emerald"
          count={trusted.length}
          results={trusted}
        />
      )}
    </>
  );
}

function Section({
  label,
  accent,
  count,
  results,
}: {
  label: string;
  accent: "red" | "emerald";
  count: number;
  results: InvestigationResult[];
}) {
  const headColor = accent === "red" ? "text-red-400" : "text-emerald-400";
  return (
    <section className="mt-10">
      <h2 className={`mb-4 text-sm font-bold uppercase tracking-widest ${headColor}`}>
        {label} ({count})
      </h2>
      <div className="space-y-3">
        {results.map((r, i) => (
          <DealCard key={i} result={r} accent={accent} />
        ))}
      </div>
    </section>
  );
}

function DealCard({
  result,
  accent,
}: {
  result: InvestigationResult;
  accent: "red" | "emerald";
}) {
  const { candidate, trustScore, flags, evidence, verdict } = result;
  const isTrap = accent === "red";

  const border = isTrap ? "border-red-900/60" : "border-emerald-900/60";
  const bg = isTrap ? "bg-red-950/20" : "bg-emerald-950/20";
  const scoreColor = isTrap ? "text-red-400" : "text-emerald-400";
  const titleClass = isTrap
    ? "text-zinc-400 line-through decoration-red-700"
    : "text-zinc-100";

  return (
    <article className={`rounded border ${border} ${bg} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <h3 className={`text-sm font-semibold ${titleClass}`}>
          {candidate.title}
        </h3>
        <div className="shrink-0 text-right">
          <div className={`text-lg font-bold ${scoreColor}`}>{trustScore}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-600">
            trust
          </div>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
        <span className="font-bold text-zinc-200">{candidate.price}</span>
        {candidate.oldPrice && (
          <span className="text-zinc-600 line-through">{candidate.oldPrice}</span>
        )}
        <span>·</span>
        <span>{candidate.merchant || "unknown merchant"}</span>
        <span
          className={`ml-auto rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            isTrap
              ? "bg-red-900/50 text-red-300"
              : "bg-emerald-900/50 text-emerald-300"
          }`}
        >
          {verdict}
        </span>
      </div>

      {flags.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {flags.map((flag, i) => (
            <li
              key={i}
              className="rounded border border-red-900/60 bg-red-950/40 px-2 py-0.5 text-[11px] text-red-300"
            >
              ⚑ {flag}
            </li>
          ))}
        </ul>
      )}

      {evidence.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-zinc-500">
          {evidence.map((e, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-zinc-700">&gt;</span>
              <span>{e}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
