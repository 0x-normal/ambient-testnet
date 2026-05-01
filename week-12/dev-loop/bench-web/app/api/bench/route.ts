import { NextRequest } from "next/server";
import { PROVIDERS, callProvider } from "@/lib/providers";
import { DEFAULT_PROMPTS } from "@/lib/prompts";
import type {
  BenchRequestBody,
  StreamEvent,
  PromptSpec,
  ComparisonProviderConfig,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<Response> {
  let body: BenchRequestBody;
  try {
    body = (await req.json()) as BenchRequestBody;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const validation = validate(body);
  if (validation) return jsonError(validation, 400);

  const prompts = (body.prompts ?? DEFAULT_PROMPTS).slice(0, 5) as PromptSpec[];
  const timeoutMs = body.timeoutMs ?? 300_000;

  const ambientInfo = PROVIDERS.ambient;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: StreamEvent) =>
        controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));

      try {
        for (const prompt of prompts) {
          // Run Ambient + every comparison in parallel for fair timing.
          const tasks: Promise<unknown>[] = [];

          tasks.push(
            (async () => {
              send({
                type: "started",
                provider: "ambient",
                promptId: prompt.id,
              });
              const r = await callProvider({
                info: ambientInfo,
                apiKey: body.ambientKey,
                model: body.ambientModel ?? ambientInfo.defaultModel,
                prompt,
                timeoutMs,
              });
              send({ type: "result", result: r });
            })()
          );

          for (const cmp of body.comparisons) {
            const info = PROVIDERS[cmp.id];
            tasks.push(
              (async () => {
                send({ type: "started", provider: cmp.id, promptId: prompt.id });
                const r = await callProvider({
                  info,
                  apiKey: cmp.apiKey,
                  model: cmp.model ?? info.defaultModel,
                  prompt,
                  timeoutMs,
                });
                send({ type: "result", result: r });
              })()
            );
          }

          await Promise.all(tasks);
        }

        send({ type: "done" });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

function validate(b: Partial<BenchRequestBody>): string | null {
  if (!b.ambientKey || typeof b.ambientKey !== "string")
    return "ambientKey is required";
  if (!Array.isArray(b.comparisons) || b.comparisons.length === 0)
    return "at least one comparison provider is required";
  if (b.comparisons.length > 6) return "max 6 comparison providers";

  const seen = new Set<string>();
  for (const c of b.comparisons as ComparisonProviderConfig[]) {
    if (!c?.id || typeof c.id !== "string")
      return "comparison entry missing id";
    const id = c.id as string;
    if (!(id in PROVIDERS) || id === "ambient")
      return `invalid comparison provider: ${id}`;
    if (seen.has(id)) return `duplicate comparison provider: ${id}`;
    seen.add(id);
    if (!c.apiKey || typeof c.apiKey !== "string")
      return `apiKey missing for ${c.id}`;
  }
  return null;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
