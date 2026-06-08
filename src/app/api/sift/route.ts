/**
 * POST /api/sift
 *
 * Runs the full investigation pipeline: query -> Nimble candidates -> Groq
 * verdicts -> a partitioned SiftResult (traps vs. trusted).
 */
import { NextResponse } from "next/server";
import { investigate } from "@/lib/investigator";
import { getCachedResult, setCachedResult } from "@/lib/cache";

// Nimble + Groq calls are dynamic; never cache this route.
export const dynamic = "force-dynamic";
// LLM investigation can take a while; give it room.
export const maxDuration = 60;

interface SiftRequestBody {
  query?: unknown;
}

export async function POST(request: Request) {
  let body: SiftRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json(
      { error: "Missing or empty 'query'" },
      { status: 400 },
    );
  }

  // Serve a pre-computed result instantly when we have one — keeps the demo
  // working even if Nimble or Groq is down.
  const cached = getCachedResult(query);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  try {
    const result = await investigate(query);
    // Cache for next time, then return live. Persisting failures shouldn't fail
    // the request, so swallow any write error.
    try {
      setCachedResult(query, result);
    } catch (cacheErr) {
      console.error("[/api/sift] failed to cache result:", cacheErr);
    }
    return NextResponse.json({ ...result, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/sift] failed:", err);
    return NextResponse.json(
      { error: "Sift failed", detail: message },
      { status: 502 },
    );
  }
}
