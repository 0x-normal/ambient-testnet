export interface PromptSpec {
  id: string;
  category: string;
  prompt: string;
  expectedKeywords?: string[];
}

export type ProviderId =
  | "ambient"
  | "openai"
  | "claude"
  | "gemini"
  | "deepseek"
  | "glm"
  | "kimi";

export type ComparisonProviderId = Exclude<ProviderId, "ambient">;

export type FailureMode =
  | "timeout"
  | "auth"
  | "rate_limit"
  | "server_error"
  | "network"
  | "empty_response"
  | "cors"
  | "other";

export interface CallResult {
  provider: ProviderId;
  providerLabel: string;
  model: string;
  promptId: string;
  startedAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensEstimated?: boolean;
  output: string;
  error?: string;
  failureMode?: FailureMode;
  keywordHits?: string[];
  keywordMissed?: string[];
}

export interface ComparisonProviderConfig {
  id: ComparisonProviderId;
  apiKey: string;
  model?: string;
}

export interface BenchRequestBody {
  ambientKey: string;
  ambientModel?: string;
  comparisons: ComparisonProviderConfig[];
  prompts?: PromptSpec[];
  timeoutMs?: number;
}

export interface GeneratePromptsRequestBody {
  count: number;
  groqModel?: string;
}

export interface GeneratePromptsResponse {
  prompts: PromptSpec[];
}

export type StreamEvent =
  | { type: "started"; provider: ProviderId; promptId: string }
  | { type: "result"; result: CallResult }
  | { type: "error"; message: string }
  | { type: "done" };
