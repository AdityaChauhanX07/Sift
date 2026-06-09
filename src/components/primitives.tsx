"use client";

/**
 * Sift — shared UI primitives.
 *
 * Ported from the Claude Design prototype (claude-design/src/components.jsx) to
 * typed React. Everything is a named export; nothing is assigned to `window`.
 * These rely on browser timers / requestAnimationFrame, so the module is a
 * client component.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DependencyList,
  type ReactNode,
} from "react";

/* ——— easing ———————————————————————————————————————————————— */

export const easeOutExpo = (x: number): number =>
  x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);

export const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);

export const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

/* ——— hooks ————————————————————————————————————————————————— */

/** Run `callback(elapsedMs)` every frame while `active` is true. */
export function useRaf(
  callback: (elapsed: number) => void,
  active: boolean,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  useEffect(() => {
    if (!active) return;
    let id = 0;
    let start: number | null = null;
    const loop = (ts: number) => {
      if (start == null) start = ts;
      cbRef.current(ts - start);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/** Reveal on mount after `delay` ms; returns a boolean "shown". */
export function useReveal(delay = 0, deps: DependencyList = []): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return shown;
}

/* ——— CountUp ————————————————————————————————————————————————— */

interface CountUpProps {
  to: number;
  from?: number;
  dur?: number;
  run?: boolean;
  fmt?: (n: number) => ReactNode;
  ease?: (x: number) => number;
  delay?: number;
}

export function CountUp({
  to,
  from = 0,
  dur = 1100,
  run = true,
  fmt = (n) => Math.round(n).toLocaleString(),
  ease = easeOutExpo,
  delay = 0,
}: CountUpProps) {
  const [val, setVal] = useState(from);
  const startedRef = useRef(false);
  useEffect(() => {
    if (!run) {
      setVal(from);
      startedRef.current = false;
      return;
    }
    let raf = 0;
    let t0: number | null = null;
    const begin = () => {
      const step = (ts: number) => {
        if (t0 == null) t0 = ts;
        const p = Math.min(1, (ts - t0) / dur);
        setVal(from + (to - from) * ease(p));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const id = window.setTimeout(begin, delay);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, from, dur, run, delay]);
  return <>{fmt(val)}</>;
}

/* ——— blinking cursor ——————————————————————————————————————— */

export function Cursor({ on = true }: { on?: boolean }) {
  return (
    <span className={"cursor" + (on ? " cursor--on" : "")} aria-hidden="true" />
  );
}

/* ——— Scramble / decode text ———————————————————————————————— */

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&/\\<>*";

interface ScrambleProps {
  text: string;
  run?: boolean;
  speed?: number;
  settle?: number;
}

export function Scramble({
  text,
  run = true,
  speed = 28,
  settle = 2,
}: ScrambleProps) {
  const [out, setOut] = useState(run ? "" : text);
  useEffect(() => {
    if (!run) {
      setOut(text);
      return;
    }
    let frame = 0;
    let raf = 0;
    const total = text.length * settle + 8;
    const tick = () => {
      frame++;
      const revealed = Math.floor(frame / settle);
      let s = "";
      for (let i = 0; i < text.length; i++) {
        if (i < revealed || text[i] === " ") s += text[i];
        else s += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      setOut(s);
      if (frame < total) raf = window.setTimeout(tick, speed);
      else setOut(text);
    };
    raf = window.setTimeout(tick, speed);
    return () => clearTimeout(raf);
    // Intentionally only restart on text/run — speed/settle are read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, run]);
  return <>{out}</>;
}

/* ——— Keycap ————————————————————————————————————————————————— */

interface KeyProps {
  children: ReactNode;
  wide?: boolean;
}

export function Key({ children, wide }: KeyProps) {
  return <kbd className={"key" + (wide ? " key--wide" : "")}>{children}</kbd>;
}

/* ——— Score meter (horizontal fill) ————————————————————————— */

interface MeterProps {
  value: number;
  run?: boolean;
  delay?: number;
  dur?: number;
}

export function Meter({ value, run = true, delay = 0, dur = 900 }: MeterProps) {
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!run) {
      setW(0);
      return;
    }
    const id = window.setTimeout(() => setW(value), delay + 30);
    return () => clearTimeout(id);
  }, [value, run, delay]);
  return (
    <span className="meter" style={{ "--dur": dur + "ms" } as CSSProperties}>
      <span className="meter__fill" style={{ width: w + "%" }} />
    </span>
  );
}

/* ——— Marquee ticker ————————————————————————————————————————— */

interface TickerProps<T> {
  items: T[];
  speed?: number;
  render: (item: T, index: number) => ReactNode;
}

export function Ticker<T>({ items, speed = 38, render }: TickerProps<T>) {
  // duplicate items for a seamless loop
  const doubled = useMemo(() => items.concat(items), [items]);
  return (
    <div className="ticker">
      <div className="ticker__track" style={{ animationDuration: speed + "s" }}>
        {doubled.map((it, i) => (
          <span className="ticker__item" key={i}>
            {render(it, i)}
          </span>
        ))}
      </div>
    </div>
  );
}
