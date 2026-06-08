/**
 * POST /api/sift
 *
 * Runs the full investigation pipeline: query -> Nimble candidates -> Groq
 * verdicts -> a partitioned SiftResult (traps vs. trusted).
 */
import { NextResponse } from "next/server";
import { investigate } from "@/lib/investigator";

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

  try {
    const result = await investigate(query);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/sift] failed:", err);
    return NextResponse.json(
      { error: "Sift failed", detail: message },
      { status: 502 },
    );
  }
}
