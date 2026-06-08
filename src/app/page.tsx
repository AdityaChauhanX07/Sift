"use client";

import { useState } from "react";

interface SiftResponse {
  query: string;
  totalCandidates: number;
  candidates: unknown[];
  organicCount: number;
  organic: unknown[];
}

export default function Home() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SiftResponse | null>(null);

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
            deal trust agent — query &rarr; nimble &rarr; candidates
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
            {loading ? "sifting…" : "Sift it"}
          </button>
        </div>

        {error && (
          <div className="mt-6 rounded border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {result && (
          <section className="mt-8">
            <div className="mb-3 flex items-center gap-4 text-sm text-zinc-400">
              <span>
                <span className="text-emerald-400">
                  {result.totalCandidates}
                </span>{" "}
                shopping candidates
              </span>
              <span>
                <span className="text-emerald-400">{result.organicCount}</span>{" "}
                organic results
              </span>
            </div>
            <pre className="max-h-[60vh] overflow-auto rounded border border-zinc-800 bg-zinc-900/60 p-4 text-xs leading-relaxed text-zinc-300">
              {JSON.stringify(result, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </main>
  );
}
