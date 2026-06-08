/**
 * POST /api/sift
 *
 * First vertical slice: accept { query }, hit Nimble's SERP, and return the
 * normalized deal candidates. Investigation/scoring comes later.
 */
import { NextResponse } from "next/server";
import { NimbleClient, toDealCandidate } from "@/lib/nimble";
import type { DealCandidate } from "@/lib/types";

// Nimble calls are dynamic; never cache this route.
export const dynamic = "force-dynamic";

interface SiftRequestBody {
  query?: unknown;
}

export async function POST(request: Request) {
  let body: SiftRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json(
      { error: "Missing or empty 'query'" },
      { status: 400 },
    );
  }

  try {
    const nimble = new NimbleClient();
    const { shopping, organic } = await nimble.searchDeals(query);

    const candidates: DealCandidate[] = shopping.map(toDealCandidate);

    return NextResponse.json({
      query,
      totalCandidates: candidates.length,
      candidates,
      organicCount: organic.length,
      organic,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[/api/sift] failed:", err);
    return NextResponse.json(
      { error: "Sift failed", detail: message },
      { status: 502 },
    );
  }
}
