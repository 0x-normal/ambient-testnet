import type { ProviderId, CallResult, FailureMode, PromptSpec } from "./types";

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  defaultModel: string;
  modelOptions?: string[];
  baseURL?: string; // OpenAI-compatible base URL; absent = default OpenAI
  apiKeyHelpUrl: string;
  keyPlaceholder: string;
  isAnthropic?: boolean;
  blurb: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  ambient: {
    id: "ambient",
    label: "Ambient",
    defaultModel: "ambient/large",
    modelOptions: ["ambient/large", "zai-org/GLM-5.1-FP8"],
    baseURL: "https://api.ambient.xyz/v1",
    apiKeyHelpUrl: "https://app.ambient.xyz/keys",
    keyPlaceholder: "sk-ambient-...",
    blurb: "Verified inference. Required for the comparison.",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    modelOptions: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    apiKeyHelpUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-...",
    blurb: "GPT-4o family.",
  },
  claude: {
    id: "claude",
    label: "Claude",
    defaultModel: "claude-3-5-haiku-latest",
    modelOptions: [
      "claude-3-5-haiku-latest",
      "claude-3-5-sonnet-latest",
      "claude-opus-4-1",
    ],
    apiKeyHelpUrl: "https://console.anthropic.com/settings/keys",
    keyPlaceholder: "sk-ant-...",
    isAnthropic: true,
    blurb: "Anthropic's Claude family.",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    defaultModel: "gemini-2.5-flash",
    modelOptions: ["gemini-2.5-flash", "gemini-2.5-pro"],
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKeyHelpUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza...",
    blurb: "Google Gemini. Free tier available.",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    defaultModel: "deepseek-chat",
    modelOptions: ["deepseek-chat", "deepseek-reasoner"],
    baseURL: "https://api.deepseek.com/v1",
    apiKeyHelpUrl: "https://platform.deepseek.com/api_keys",
    keyPlaceholder: "sk-...",
    blurb: "DeepSeek V3 / R1 reasoner.",
  },
  glm: {
    id: "glm",
    label: "GLM (Zhipu)",
    defaultModel: "glm-4-flash",
    modelOptions: ["glm-4-flash", "glm-4-plus", "glm-4.5"],
    baseURL: "https://open.bigmodel.cn/api/paas/v4/",
    apiKeyHelpUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    keyPlaceholder: "xxx.xxx",
    blurb: "Zhipu's GLM family.",
  },
  kimi: {
    id: "kimi",
    label: "Kimi (Moonshot)",
    defaultModel: "moonshot-v1-8k",
    modelOptions: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    baseURL: "https://api.moonshot.cn/v1",
    apiKeyHelpUrl: "https://platform.moonshot.cn/console/api-keys",
    keyPlaceholder: "sk-...",
    blurb: "Moonshot's Kimi.",
  },
};

/**
 * Unified provider call. Server-side only — handles both OpenAI-compatible
 * endpoints (most providers) and Anthropic's /v1/messages shape.
 */
export async function callProvider(args: {
  info: ProviderInfo;
  apiKey: string;
  model: string;
  prompt: PromptSpec;
  timeoutMs: number;
}): Promise<CallResult> {
  const { info, apiKey, model, prompt, timeoutMs } = args;
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let output = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let tokensEstimated = false;

    if (info.isAnthropic) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [{ role: "user", content: prompt.prompt }],
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new HttpError(resp.status, await safeText(resp));
      }
      const j = await resp.json();
      output = (j?.content?.[0]?.text ?? "").trim();
      inputTokens = j?.usage?.input_tokens;
      outputTokens = j?.usage?.output_tokens;
    } else {
      const baseURL = info.baseURL ?? "https://api.openai.com/v1";
      const url = `${baseURL.replace(/\/$/, "")}/chat/completions`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt.prompt }],
        }),
        signal: controller.signal,
      });
      if (!resp.ok) {
        throw new HttpError(resp.status, await safeText(resp));
      }
      const j = await resp.json();
      output = (j?.choices?.[0]?.message?.content ?? "").trim();
      inputTokens = j?.usage?.prompt_tokens;
      outputTokens = j?.usage?.completion_tokens;
    }

    const latencyMs = Math.round(performance.now() - start);

    if (inputTokens == null || outputTokens == null) {
      tokensEstimated = true;
      inputTokens = Math.round(prompt.prompt.length / 4);
      outputTokens = Math.round(output.length / 4);
    }

    const result: CallResult = {
      provider: info.id,
      providerLabel: info.label,
      model,
      promptId: prompt.id,
      startedAt,
      latencyMs,
      inputTokens,
      outputTokens,
      tokensEstimated,
      output,
    };

    if (!output) {
      result.error = "empty response from provider";
      result.failureMode = "empty_response";
    }

    annotateKeywords(result, prompt);
    return result;
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - start);
    const { message, mode } = classifyError(err);
    return {
      provider: info.id,
      providerLabel: info.label,
      model,
      promptId: prompt.id,
      startedAt,
      latencyMs,
      output: "",
      error: message,
      failureMode: mode,
    };
  } finally {
    clearTimeout(timer);
  }
}

class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`${status} ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return "<unreadable response body>";
  }
}

function annotateKeywords(res: CallResult, prompt: PromptSpec): void {
  if (!prompt.expectedKeywords?.length || !res.output) return;
  const lower = res.output.toLowerCase();
  const hits: string[] = [];
  const missed: string[] = [];
  for (const kw of prompt.expectedKeywords) {
    if (lower.includes(kw.toLowerCase())) hits.push(kw);
    else missed.push(kw);
  }
  res.keywordHits = hits;
  res.keywordMissed = missed;
}

function classifyError(err: unknown): { message: string; mode: FailureMode } {
  if (err instanceof HttpError) {
    if (err.status === 401 || err.status === 403)
      return { message: err.message, mode: "auth" };
    if (err.status === 429) return { message: err.message, mode: "rate_limit" };
    if (err.status >= 500) return { message: err.message, mode: "server_error" };
    return { message: err.message, mode: "other" };
  }
  if (err instanceof Error) {
    const name = err.name?.toLowerCase() ?? "";
    const msg = err.message ?? "";
    const lower = msg.toLowerCase();
    if (name === "aborterror" || lower.includes("aborted")) {
      return { message: msg || "request timed out", mode: "timeout" };
    }
    if (lower.includes("fetch failed") || lower.includes("econn")) {
      return { message: msg, mode: "network" };
    }
    return { message: msg, mode: "other" };
  }
  return { message: String(err), mode: "other" };
}
