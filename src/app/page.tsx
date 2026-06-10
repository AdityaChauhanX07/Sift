"use client";

/**
 * Sift — the forensic shopping investigator.
 *
 * A three-act single page: Landing (state a query) -> Investigation (watch the
 * live /api/sift stream) -> Results (the verdict). Mirrors the state machine
 * from the Claude Design prototype (claude-design/src/app.jsx).
 *
 * The current phase + query are mirrored into the URL hash (#results?q=… etc.)
 * so a refresh restores the view and the browser back button works. We drive the
 * URL with history.pushState/replaceState (which do NOT fire popstate), and only
 * react to genuine back/forward via the popstate listener — so our own updates
 * never feed back into a loop.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Landing } from "@/components/Landing";
import { Investigation } from "@/components/Investigation";
import { Results } from "@/components/Results";
import { SiftMark } from "@/components/SiftMark";
import { Key } from "@/components/primitives";
import type { SiftResult } from "@/lib/types";
import "./sift.css";

type Phase = "landing" | "investigating" | "results";

/* ------------------------------ URL hash ------------------------------- */

/** Read the current URL hash into a phase + query. Defaults to landing. */
function parseHash(): { phase: Phase; query: string } {
  if (typeof window === "undefined") return { phase: "landing", query: "" };
  const raw = window.location.hash.replace(/^#/, "");
  if (!raw) return { phase: "landing", query: "" };
  const qIdx = raw.indexOf("?");
  const phasePart = qIdx === -1 ? raw : raw.slice(0, qIdx);
  const queryPart = qIdx === -1 ? "" : raw.slice(qIdx + 1);
  const phase: Phase =
    phasePart === "investigating" || phasePart === "results"
      ? phasePart
      : "landing";
  let query = "";
  const m = /(?:^|&)q=([^&]*)/.exec(queryPart);
  if (m) {
    try {
      query = decodeURIComponent(m[1]);
    } catch {
      query = m[1];
    }
  }
  return { phase, query };
}

/** Build the hash fragment for a phase ("" clears it, for landing). */
function hashFor(phase: Phase, query: string): string {
  if (phase === "landing") return "";
  return `#${phase}?q=${encodeURIComponent(query)}`;
}

/**
 * Fetch a query's result but ONLY accept it if it came from the cache. Used on
 * refresh/back so we restore results without kicking off a fresh live
 * investigation: if the stream goes live, the timeout aborts it and we return
 * null (→ caller falls back to landing). Cached responses complete in ~2.4s.
 */
async function fetchCachedOnly(query: string): Promise<SiftResult | null> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch("/api/sift", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let e: { stage?: string; data?: SiftResult; cached?: boolean };
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (e.stage === "complete") {
          controller.abort();
          return e.cached === true && e.data ? e.data : null;
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------- restoring ----------------------------- */

function RestoringPanel() {
  return (
    <div className="land" style={{ minHeight: "70vh" }}>
      <div
        className="land__kicker eyebrow"
        style={{ opacity: 1, animation: "none" }}
      >
        <span className="pulse" />
        restoring investigation…
      </div>
    </div>
  );
}

/* ================================ page ================================ */

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [query, setQuery] = useState("wireless earbuds under $50");
  const [result, setResult] = useState<SiftResult | null>(null);
  const [restoring, setRestoring] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Latest values for use inside stable callbacks (avoids stale closures).
  const resultRef = useRef(result);
  resultRef.current = result;
  const queryRef = useRef(query);
  queryRef.current = query;

  /** Mirror a phase + query into the URL. Uses push/replace (no popstate). */
  const syncHash = useCallback(
    (p: Phase, q: string, replace = false) => {
      const target = hashFor(p, q);
      const url = window.location.pathname + window.location.search + target;
      if (replace) {
        window.history.replaceState(null, "", url);
      } else if (window.location.hash !== target) {
        window.history.pushState(null, "", url);
      }
    },
    [],
  );

  const investigate = useCallback(() => {
    setResult(null);
    setRestoring(false);
    setPhase("investigating");
    window.scrollTo({ top: 0 });
    syncHash("investigating", queryRef.current);
  }, [syncHash]);

  const toResults = useCallback(
    (data: SiftResult) => {
      setResult(data);
      setRestoring(false);
      setPhase("results");
      window.scrollTo({ top: 0 });
      // Replace so "back" from results returns to landing rather than re-running
      // the investigation that produced it.
      syncHash("results", data.query, true);
    },
    [syncHash],
  );

  const reset = useCallback(() => {
    setRestoring(false);
    setResult(null);
    setPhase("landing");
    window.scrollTo({ top: 0 });
    syncHash("landing", "");
    window.setTimeout(() => inputRef.current?.focus(), 200);
  }, [syncHash]);

  /** Restore state from the current URL hash (on load and on back/forward). */
  const applyHash = useCallback(async () => {
    const { phase: hPhase, query: hQuery } = parseHash();

    if (hPhase === "landing" || !hQuery) {
      setRestoring(false);
      setResult(null);
      setPhase("landing");
      return;
    }

    if (hPhase === "investigating") {
      setResult(null);
      setQuery(hQuery);
      setRestoring(false);
      setPhase("investigating");
      return;
    }

    // hPhase === "results"
    setQuery(hQuery);
    if (resultRef.current && resultRef.current.query === hQuery) {
      setRestoring(false);
      setPhase("results");
      return;
    }
    // Need the data — accept only a cached hit, else fall back to landing.
    setRestoring(true);
    const data = await fetchCachedOnly(hQuery);
    if (data) {
      setResult(data);
      setPhase("results");
      setRestoring(false);
    } else {
      setRestoring(false);
      setResult(null);
      setPhase("landing");
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
  }, []);

  // Restore on first load, then on every back/forward navigation.
  useEffect(() => {
    void applyHash();
    const onPop = () => void applyHash();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyHash]);

  // ⌘K / Ctrl+K → start a new search (return to landing, focus the input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (phase !== "landing" || restoring) reset();
        else inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, restoring, reset]);

  // Focus the search input shortly after first load (landing only).
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (phase === "landing" && !restoring) inputRef.current?.focus();
    }, 700);
    return () => clearTimeout(id);
  }, [phase, restoring]);

  const showLandingChrome = phase === "landing" && !restoring;

  return (
    <div className="stage">
      <header className="chrome">
        {/* Brand doubles as a "home" button → back to landing. */}
        <button
          type="button"
          className="brand"
          onClick={reset}
          aria-label="Sift — back to start"
          style={{
            cursor: "pointer",
            background: "none",
            border: "none",
            padding: 0,
            font: "inherit",
            color: "inherit",
          }}
        >
          <span className="brand__mark">
            <SiftMark />
          </span>
          <span className="brand__name">
            sift<span className="brand__dot">.</span>
          </span>
        </button>
        <div className="chrome__meta">
          {showLandingChrome ? (
            <span className="eyebrow">forensic shopping</span>
          ) : (
            <button
              className="invest__skip"
              onClick={reset}
              style={{ fontSize: 12 }}
            >
              <span className="mono" style={{ color: "var(--accent)" }}>
                ›
              </span>{" "}
              new search <Key>⌘K</Key>
            </button>
          )}
        </div>
      </header>

      {/* key remounts the scene so its enter animation replays. */}
      <div className="scene scene--in" key={restoring ? "restoring" : phase}>
        {restoring ? (
          <RestoringPanel />
        ) : (
          <>
            {phase === "landing" && (
              <Landing
                query={query}
                setQuery={setQuery}
                onSubmit={investigate}
                inputRef={inputRef}
              />
            )}
            {phase === "investigating" && (
              <Investigation query={query} onComplete={toResults} />
            )}
            {phase === "results" && result && (
              <Results query={query} result={result} onReset={reset} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
