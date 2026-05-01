import { NextRequest } from "next/server";
import type {
  GeneratePromptsRequestBody,
  GeneratePromptsResponse,
  PromptSpec,
} from "@/lib/types";


export const runtime = "nodejs";
export const maxDuration = 60;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

const SYSTEM = `You generate diverse benchmark prompts for evaluating large language models.
Return ONLY valid JSON — no prose, no markdown fences. Output shape:
{ "prompts": [ { "id": "p1-short-slug", "category": "<one of: reasoning|recall|code|summarization|calibration|creative>", "prompt": "<the prompt text>", "expectedKeywords": ["kw1","kw2"] } ] }
Rules:
- Mix categories. Do not repeat the same category twice in a row.
- Each prompt must be self-contained (no external context required).
- expectedKeywords are short, lowercase substrings the correct answer should contain (2–4 each). Omit for creative/open-ended prompts.
- ids are short kebab-case slugs unique within the array.`;

export async function POST(req: NextRequest): Promise<Response> {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return jsonError(
      "server is not configured for auto-generate (missing GROQ_API_KEY)",
      503
    );
  }

  let body: GeneratePromptsRequestBody;
  try {
    body = (await req.json()) as GeneratePromptsRequestBody;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const count = Math.max(1, Math.min(5, Number(body.count) || 3));
  const model = body.groqModel || DEFAULT_GROQ_MODEL;

  const userMsg = `Generate exactly ${count} benchmark prompts following the JSON schema. Vary the category mix.`;

  let resp: Response;
  try {
    resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        response_format: { type: "json_object" },
        temperature: 0.8,
      }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonError(`groq network error: ${msg}`, 502);
  }

  if (!resp.ok) {
    const text = await safeText(resp);
    return jsonError(`groq ${resp.status}: ${text.slice(0, 300)}`, 502);
  }

  let data: { choices?: Array<{ message?: { content?: string } }> };
  try {
    data = (await resp.json()) as typeof data;
  } catch {
    return jsonError("groq returned non-JSON", 502);
  }

  const raw = data?.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw) return jsonError("groq returned empty content", 502);

  let parsed: { prompts?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return jsonError(
      `groq output not parseable: ${raw.slice(0, 200)}`,
      502
    );
  }

  if (!Array.isArray(parsed.prompts))
    return jsonError("groq output missing 'prompts' array", 502);

  const cleaned: PromptSpec[] = (parsed.prompts as Array<Partial<PromptSpec>>)
    .slice(0, count)
    .map((p, i) => ({
      id:
        typeof p.id === "string" && p.id.trim()
          ? p.id.trim().toLowerCase().replace(/\s+/g, "-")
          : `gen-${i + 1}`,
      category:
        typeof p.category === "string" && p.category.trim()
          ? p.category.trim().toLowerCase()
          : "reasoning",
      prompt:
        typeof p.prompt === "string" ? p.prompt.trim() : "",
      expectedKeywords:
        Array.isArray(p.expectedKeywords) &&
        p.expectedKeywords.every((k) => typeof k === "string")
          ? (p.expectedKeywords as string[])
              .map((k) => k.trim().toLowerCase())
              .filter(Boolean)
              .slice(0, 6)
          : undefined,
    }))
    .filter((p) => p.prompt.length > 5);

  if (cleaned.length === 0)
    return jsonError("groq produced no usable prompts", 502);

  const out: GeneratePromptsResponse = { prompts: cleaned };
  return Response.json(out);
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "<unreadable response body>";
  }
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
