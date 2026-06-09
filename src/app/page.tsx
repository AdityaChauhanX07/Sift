"use client";

/**
 * Sift — the forensic shopping investigator.
 *
 * A three-act single page: Landing (state a query) -> Investigation (watch the
 * live /api/sift stream) -> Results (the verdict). Mirrors the state machine
 * from the Claude Design prototype (claude-design/src/app.jsx).
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

export default function Home() {
  const [phase, setPhase] = useState<Phase>("landing");
  const [query, setQuery] = useState("wireless earbuds under $50");
  const [result, setResult] = useState<SiftResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const investigate = useCallback(() => {
    setResult(null);
    setPhase("investigating");
    window.scrollTo({ top: 0 });
  }, []);

  const toResults = useCallback((data: SiftResult) => {
    setResult(data);
    setPhase("results");
    window.scrollTo({ top: 0 });
  }, []);

  const reset = useCallback(() => {
    setPhase("landing");
    setResult(null);
    window.scrollTo({ top: 0 });
    window.setTimeout(() => inputRef.current?.focus(), 200);
  }, []);

  // ⌘K / Ctrl+K → start a new search (return to landing, focus the input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        if (phase !== "landing") reset();
        else inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, reset]);

  // Focus the search input shortly after first load.
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 700);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="stage">
      <header className="chrome">
        <div className="brand">
          <span className="brand__mark">
            <SiftMark />
          </span>
          <span className="brand__name">
            sift<span className="brand__dot">.</span>
          </span>
        </div>
        <div className="chrome__meta">
          {phase === "landing" ? (
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

      {/* key={phase} remounts the scene so its enter animation replays. */}
      <div className="scene scene--in" key={phase}>
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
      </div>
    </div>
  );
}
