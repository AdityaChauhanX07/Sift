"use client";

/**
 * Sift — Act 2: Investigation (live forensic stream).
 *
 * Ported from the Claude Design prototype (claude-design/src/Investigation.jsx),
 * but instead of a scripted log it drives the console from the REAL /api/sift
 * NDJSON stream. The four visual rail stages map onto the live pipeline events:
 *
 *   searching + found   -> Crawl       (gather candidates)
 *   enriching           -> Extract     (scrape product pages)
 *   source_lookup       -> Cross-examine (check AliExpress sources)
 *   investigating       -> Verdict     (AI classification)
 *   complete            -> done -> onComplete(data)
 *
 * The live stream emits source_lookup before enriching, which is the reverse of
 * the rail's Extract/Cross-examine order, so the rail advances monotonically
 * (furthest stage reached) and never visually jumps backwards.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CountUp, Cursor, Key } from "./primitives";
import type { ProgressEvent, SiftResult } from "@/lib/types";

interface InvestigationProps {
  query: string;
  onComplete: (data: SiftResult) => void;
  /**
   * Fired when the user asks to skip but the data isn't ready yet. Optional —
   * the transition to results always goes through onComplete, so the in-flight
   * fetch is never torn down by a skip.
   */
  onSkip?: () => void;
}

/** Rail stages, in display order. */
const STAGES = [
  { id: "crawl", label: "Crawl", desc: "gather listings across sources" },
  { id: "extract", label: "Extract", desc: "scrape real product data" },
  { id: "examine", label: "Cross-examine", desc: "check AliExpress for source matches" },
  { id: "verdict", label: "Verdict", desc: "AI classifies every deal" },
] as const;

type StageId = (typeof STAGES)[number]["id"];
const STAGE_ORDER: StageId[] = STAGES.map((s) => s.id);

/** Console line "kinds" — drive the log--<kind> color class + leading glyph. */
type LogKind = "head" | "sys" | "ok" | "pass" | "flag" | "kill" | "done";

const ARROW: Record<LogKind, string> = {
  head: "▸",
  sys: "›",
  ok: "✓",
  pass: "✓",
  flag: "✕",
  kill: "✕",
  done: "■",
};

interface LogLine {
  kind: LogKind;
  text: string;
  arrow: string;
  /** Elapsed ms since the run started, for the left-hand timestamp. */
  t: number;
}

interface Counts {
  scanned: number;
  flagged: number;
  cleared: number;
}

const fmt = (n: number): string => Math.round(n).toLocaleString();
const tstamp = (ms: number): string =>
  (ms / 1000).toFixed(2).padStart(5, "0");

export function Investigation({
  query,
  onComplete,
  onSkip,
}: InvestigationProps) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stage, setStage] = useState<StageId>("crawl");
  const [counts, setCounts] = useState<Counts>({
    scanned: 0,
    flagged: 0,
    cleared: 0,
  });
  const [candidateCount, setCandidateCount] = useState(0);
  const [done, setDone] = useState(false);
  const [skipHint, setSkipHint] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const targetRef = useRef<Counts>({ scanned: 0, flagged: 0, cleared: 0 });
  const timersRef = useRef<number[]>([]);
  // Buffered final result + whether the user has already asked to skip.
  const completedRef = useRef<SiftResult | null>(null);
  const skippedRef = useRef(false);

  // Keep the latest callbacks in refs so the streaming effect can stay keyed on
  // [query] alone and never tear down mid-stream when the parent re-renders.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const onSkipRef = useRef(onSkip);
  onSkipRef.current = onSkip;

  /** Append a console line, stamped with elapsed time. */
  const addLog = useCallback(
    (kind: LogKind, text: string, arrowOverride?: string) => {
      const t = Date.now() - startRef.current;
      setLogs((prev) => [
        ...prev,
        { kind, text, arrow: arrowOverride ?? ARROW[kind], t },
      ]);
    },
    [],
  );

  /** Move the rail forward only — never regress to an earlier stage. */
  const advanceStage = useCallback((id: StageId) => {
    setStage((cur) =>
      STAGE_ORDER.indexOf(id) > STAGE_ORDER.indexOf(cur) ? id : cur,
    );
  }, []);

  /**
   * Skip to the verdict. If the data is already buffered, reveal it now (drop
   * the post-complete hold); otherwise remember the intent so onComplete fires
   * the instant the stream finishes. Never tears down the in-flight fetch.
   */
  const requestSkip = useCallback(() => {
    if (completedRef.current) {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      onCompleteRef.current(completedRef.current);
    } else {
      skippedRef.current = true;
      setSkipHint(true);
      onSkipRef.current?.();
    }
  }, []);

  // ——— the live stream ———
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    startRef.current = Date.now();
    const timers = timersRef.current;

    /** Schedule a few flavor lines for visual richness between real events. */
    const pad = (texts: string[], gap = 240) => {
      texts.forEach((tx, i) => {
        const id = window.setTimeout(() => {
          if (!cancelled) addLog("sys", tx);
        }, gap * (i + 1));
        timers.push(id);
      });
    };

    const handleEvent = (ev: ProgressEvent) => {
      switch (ev.stage) {
        case "searching":
          advanceStage("crawl");
          addLog("sys", "dispatching search to Nimble SERP");
          break;

        case "found": {
          advanceStage("crawl");
          const n = ev.count ?? 0;
          setCandidateCount(n);
          targetRef.current.scanned = n;
          addLog("ok", `${n.toLocaleString()} candidates collected`);
          pad(["normalizing listing records", "resolving seller identities"]);
          break;
        }

        case "enriching":
          advanceStage("extract");
          addLog("head", ev.message ?? "extracting verified product data");
          break;

        case "source_lookup": {
          advanceStage("examine");
          addLog("flag", `check[source] — ${ev.message ?? "checking AliExpress sources"}`);
          if (ev.current != null) targetRef.current.flagged = ev.current;
          break;
        }

        case "investigating":
          advanceStage("verdict");
          addLog("head", "AI classifying all candidates");
          pad(["scoring survivors", "sorting by trust"]);
          break;

        case "complete": {
          advanceStage("verdict");
          const data = ev.data;
          if (data) {
            setCandidateCount(data.totalChecked);
            targetRef.current = {
              scanned: data.totalChecked,
              flagged: data.traps.length,
              cleared: data.trusted.length,
            };
            addLog("done", "verdict ready");
            completedRef.current = data;
            if (skippedRef.current) {
              // The user already asked to skip — reveal the verdict at once.
              onCompleteRef.current(data);
            } else {
              const id = window.setTimeout(() => {
                if (!cancelled) onCompleteRef.current(data);
              }, 900);
              timers.push(id);
            }
          }
          setDone(true);
          break;
        }

        case "error":
          addLog("flag", ev.message ?? "investigation failed");
          setDone(true);
          break;
      }
    };

    const run = async () => {
      try {
        const res = await fetch("/api/sift", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.detail || data.error || `HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Read the NDJSON stream line by line as it arrives.
        for (;;) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim() || cancelled) continue;
            handleEvent(JSON.parse(line) as ProgressEvent);
          }
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        addLog("flag", err instanceof Error ? err.message : "investigation failed");
        setDone(true);
      }
    };

    run();

    return () => {
      cancelled = true;
      controller.abort();
      timers.forEach(clearTimeout);
      timersRef.current = [];
    };
  }, [query, addLog, advanceStage]);

  // ——— lerp the metric counters toward their targets ———
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setCounts((c) => {
        const t = targetRef.current;
        const lerp = (a: number, b: number) =>
          Math.abs(b - a) < 0.6 ? b : a + (b - a) * 0.12;
        return {
          scanned: lerp(c.scanned, t.scanned),
          flagged: lerp(c.flagged, t.flagged),
          cleared: lerp(c.cleared, t.cleared),
        };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ——— autoscroll the console to the newest line ———
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  // ——— Esc / Enter requests the skip ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        requestSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestSkip]);

  const stageIdx = STAGES.findIndex((s) => s.id === stage);
  const progress = done
    ? 100
    : Math.round(((stageIdx + 1) / STAGES.length) * 92);
  const lastT = logs.length ? logs[logs.length - 1].t : 0;

  return (
    <div className="invest">
      <div className="invest__head">
        <div className="invest__q">
          <span className="qmark">›</span>
          {query}
        </div>
        <button className="invest__skip" onClick={requestSkip}>
          {skipHint ? "finishing…" : "skip to verdict"} <Key wide>esc</Key>
        </button>
      </div>

      {/* rail */}
      <div className="rail">
        {STAGES.map((s, i) => {
          const status =
            i < stageIdx ? "done" : i === stageIdx ? "active" : "pending";
          let count: ReactNode = null;
          if (s.id === "crawl" && candidateCount > 0) {
            count = (
              <>
                <CountUp to={candidateCount} dur={900} /> listings collected
              </>
            );
          } else if (s.id === "extract" && i <= stageIdx) {
            count = "scraping product pages";
          } else if (s.id === "examine" && i <= stageIdx) {
            count = `${fmt(counts.flagged)} source checks`;
          } else if (s.id === "verdict" && i <= stageIdx) {
            count = `${fmt(counts.cleared)} cleared to buy`;
          }
          return (
            <div key={s.id} className={`stage-row ${status}`}>
              <span className="stage-row__node" />
              <span className="stage-row__line" />
              <div className="stage-row__label">
                <span className="st">0{i + 1}</span>
                {s.label}
              </div>
              <div className="stage-row__desc">{s.desc}</div>
              {count && <div className="stage-row__count tnum">{count}</div>}
            </div>
          );
        })}
      </div>

      {/* console */}
      <div className="console">
        <div className="console__bar">
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span className="console__dots">
              <i />
              <i />
              <i />
            </span>
            <span className="console__title">sift://investigate</span>
          </div>
          <div className="console__metrics tnum">
            <span>
              <span className="k">scanned </span>
              <b>{fmt(counts.scanned)}</b>
            </span>
            <span>
              <span className="k">flagged </span>
              <b>{fmt(counts.flagged)}</b>
            </span>
            <span>
              <span className="k">cleared </span>
              <b style={{ color: "var(--accent)" }}>{fmt(counts.cleared)}</b>
            </span>
          </div>
        </div>

        <div className="console__body" ref={bodyRef}>
          {logs.map((e, i) => (
            <div className={`log log--${e.kind}`} key={i}>
              <span className="log__t">{tstamp(e.t)}</span>
              <span className="log__txt">
                {e.arrow && <span className="arrow">{e.arrow} </span>}
                {e.text}
              </span>
            </div>
          ))}
          {!done && (
            <div className="log">
              <span className="log__t">{tstamp(lastT)}</span>
              <span className="log__txt">
                <Cursor on />
              </span>
            </div>
          )}
        </div>

        <div className="console__progress">
          <i style={{ width: progress + "%" }} />
        </div>
      </div>
    </div>
  );
}
