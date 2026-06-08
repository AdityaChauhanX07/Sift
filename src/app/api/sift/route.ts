/**
 * POST /api/sift
 *
 * Runs the full investigation pipeline: query -> Nimble candidates -> AliExpress
 * source lookup -> Groq verdicts -> a partitioned SiftResult. The response is
 * streamed as newline-delimited JSON (NDJSON): a series of progress events while
 * the pipeline runs, then a final {"stage":"complete","data":<SiftResult>}.
 *
 * Cached queries are served instantly but still stream a fast simulated version
 * of the progress flow, so the demo always shows the investigation happening.
 */
import { NextResponse } from "next/server";
import { investigate } from "@/lib/investigator";
import { getCachedResult, setCachedResult } from "@/lib/cache";
import type { ProgressEvent, ProgressFn, SiftResult } from "@/lib/types";

// Nimble + Groq calls are dynamic; never cache this route.
export const dynamic = "force-dynamic";
// LLM investigation can take a while; give it room.
export const maxDuration = 60;

interface SiftRequestBody {
  query?: unknown;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream a fast, simulated version of the real progress flow for a cached
 * result (~2s total), using real counts mined from the cached data so the demo
 * still shows the investigation steps — just quicker.
 */
async function streamCachedProgress(send: ProgressFn, cached: SiftResult) {
  const all = [...cached.traps, ...cached.trusted];
  const sourceMatches = all.filter((r) => r.candidate.sourceMatch).length;
  const enriched = all.filter((r) => r.candidate.enrichment).length;

  send({ stage: "searching", message: "Searching the web for deals..." });
  await wait(500);

  send({
    stage: "found",
    message: `Found ${cached.totalChecked} candidates`,
    count: cached.totalChecked,
  });
  await wait(450);

  if (sourceMatches > 0) {
    send({
      stage: "source_lookup",
      message: `Found ${sourceMatches} AliExpress source matches`,
      current: sourceMatches,
      total: sourceMatches,
    });
    await wait(450);
  }

  if (enriched > 0) {
    send({
      stage: "enriching",
      message: "Extracting verified data from product pages...",
      current: enriched,
      total: enriched,
    });
    await wait(450);
  }

  send({
    stage: "investigating",
    message: "Analyzing with AI — classifying each deal...",
  });
  await wait(500);
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: ProgressFn = (event: ProgressEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        // Serve a pre-computed result instantly when we have one — keeps the
        // demo working even if Nimble or Groq is down. Stream fast fake progress
        // first so the investigation flow is still visible.
        const cached = getCachedResult(query);
        if (cached) {
          await streamCachedProgress(send, cached);
          send({ stage: "complete", data: cached, cached: true });
          controller.close();
          return;
        }

        const result = await investigate(query, send);
        // Cache for next time; a write failure shouldn't fail the request.
        try {
          setCachedResult(query, result);
        } catch (cacheErr) {
          console.error("[/api/sift] failed to cache result:", cacheErr);
        }
        send({ stage: "complete", data: result, cached: false });
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[/api/sift] failed:", err);
        send({ stage: "error", message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
