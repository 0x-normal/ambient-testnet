"use client";

import { useEffect, useMemo, useState } from "react";
import { PROVIDERS } from "@/lib/providers";
import { DEFAULT_PROMPTS } from "@/lib/prompts";
import type {
  CallResult,
  ComparisonProviderId,
  PromptSpec,
  StreamEvent,
} from "@/lib/types";

type CmpId = ComparisonProviderId;

const COMPARISON_IDS: CmpId[] = [
  "openai",
  "claude",
  "gemini",
  "deepseek",
  "glm",
  "kimi",
];

interface CmpEntry {
  enabled: boolean;
  apiKey: string;
  model: string;
}

interface RunState {
  status: "idle" | "running" | "done" | "error";
  results: CallResult[];
  errorMessage?: string;
  startedAt?: number;
  finishedAt?: number;
}

const INITIAL_RUN: RunState = { status: "idle", results: [] };
const MAX_PROMPTS = 5;
const MIN_PROMPTS = 1;
const DEFAULT_COUNT = 3;

function initialComparisons(): Record<CmpId, CmpEntry> {
  const obj = {} as Record<CmpId, CmpEntry>;
  for (const id of COMPARISON_IDS) {
    obj[id] = {
      enabled: id === "gemini",
      apiKey: "",
      model: PROVIDERS[id].defaultModel,
    };
  }
  return obj;
}

function takeDefaults(count: number): PromptSpec[] {
  return DEFAULT_PROMPTS.slice(0, count).map((p) => ({ ...p }));
}

export default function HomePage() {
  // Ambient
  const [ambientKey, setAmbientKey] = useState("");
  const [ambientModel, setAmbientModel] = useState(
    PROVIDERS.ambient.defaultModel
  );

  // Comparison providers
  const [comparisons, setComparisons] = useState<Record<CmpId, CmpEntry>>(
    initialComparisons
  );

  // Prompts
  const [promptCount, setPromptCount] = useState(DEFAULT_COUNT);
  const [prompts, setPrompts] = useState<PromptSpec[]>(() =>
    takeDefaults(DEFAULT_COUNT)
  );

  // Auto-generate (Groq lives server-side now)
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Run
  const [run, setRun] = useState<RunState>(INITIAL_RUN);

  // Resize prompt list when count changes (keep edits, top up from defaults)
  useEffect(() => {
    setPrompts((cur) => {
      if (cur.length === promptCount) return cur;
      if (cur.length > promptCount) return cur.slice(0, promptCount);
      const extras = DEFAULT_PROMPTS.slice(cur.length, promptCount).map((p) => ({
        ...p,
      }));
      while (extras.length < promptCount - cur.length) {
        const i = cur.length + extras.length + 1;
        extras.push({
          id: `slot-${i}`,
          category: "custom",
          prompt: "",
        });
      }
      return [...cur, ...extras];
    });
  }, [promptCount]);

  const enabledComparisons = COMPARISON_IDS.filter((id) => comparisons[id].enabled);

  const validPrompts = prompts.filter((p) => p.prompt.trim().length > 5);
  const allComparisonKeysFilled = enabledComparisons.every(
    (id) => comparisons[id].apiKey.trim().length > 5
  );

  const canRun =
    ambientKey.trim().length > 5 &&
    enabledComparisons.length >= 1 &&
    allComparisonKeysFilled &&
    validPrompts.length === prompts.length &&
    prompts.length >= MIN_PROMPTS &&
    run.status !== "running";

  const canGenerate = !generating;

  function toggleComparison(id: CmpId): void {
    setComparisons((c) => ({ ...c, [id]: { ...c[id], enabled: !c[id].enabled } }));
  }

  function updateComparison(id: CmpId, patch: Partial<CmpEntry>): void {
    setComparisons((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  }

  function updatePrompt(idx: number, patch: Partial<PromptSpec>): void {
    setPrompts((arr) => {
      const next = arr.slice();
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }

  function resetPromptsToDefaults(): void {
    setPrompts(takeDefaults(promptCount));
  }

  async function autoGenerate(): Promise<void> {
    if (!canGenerate) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const resp = await fetch("/api/generate-prompts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: promptCount }),
      });
      const data = (await resp.json()) as
        | { prompts: PromptSpec[] }
        | { error: string };
      if (!resp.ok || "error" in data) {
        setGenerateError("error" in data ? data.error : `HTTP ${resp.status}`);
        return;
      }
      const generated = data.prompts.slice(0, promptCount);
      // pad if Groq returned fewer than requested
      while (generated.length < promptCount) {
        const i = generated.length + 1;
        generated.push({ id: `slot-${i}`, category: "custom", prompt: "" });
      }
      setPrompts(generated);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setGenerateError(msg);
    } finally {
      setGenerating(false);
    }
  }

  async function startBench(): Promise<void> {
    setRun({ status: "running", results: [], startedAt: Date.now() });
    try {
      const body = {
        ambientKey,
        ambientModel,
        comparisons: enabledComparisons.map((id) => ({
          id,
          apiKey: comparisons[id].apiKey,
          model: comparisons[id].model,
        })),
        prompts,
      };
      const resp = await fetch("/api/bench", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok || !resp.body) {
        const text = await resp.text();
        setRun({
          status: "error",
          results: [],
          errorMessage: `${resp.status}: ${text.slice(0, 300)}`,
        });
        return;
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      const collected: CallResult[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const evt = JSON.parse(line) as StreamEvent;
            if (evt.type === "result") {
              collected.push(evt.result);
              setRun((p) => ({
                ...p,
                status: "running",
                results: [...collected],
              }));
            } else if (evt.type === "done") {
              setRun((p) => ({
                ...p,
                status: "done",
                finishedAt: Date.now(),
              }));
            } else if (evt.type === "error") {
              setRun((p) => ({
                ...p,
                status: "error",
                errorMessage: evt.message,
              }));
            }
          } catch {
            // ignore malformed line
          }
        }
      }
      setRun((p) =>
        p.status === "running"
          ? { ...p, status: "done", finishedAt: Date.now() }
          : p
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRun({ status: "error", results: [], errorMessage: msg });
    }
  }

  function exportJson(): void {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            ambientModel,
            prompts,
            results: run.results,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ambient-bench-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen">
      <Nav canRun={canRun} onRun={startBench} running={run.status === "running"} />
      <Hero />

      <main className="mx-auto max-w-[1100px] px-6 pb-20">
        {/* Section: Ambient + comparisons */}
        <SectionHeader
          eyebrow="Step 1"
          title="Pick your providers"
          sub="Ambient is required. Add one or more comparison providers (up to 6)."
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <AmbientCard
            apiKey={ambientKey}
            onApiKeyChange={setAmbientKey}
            model={ambientModel}
            onModelChange={setAmbientModel}
          />
          <ComparisonsCard
            comparisons={comparisons}
            onToggle={toggleComparison}
            onUpdate={updateComparison}
          />
        </div>

        {/* Section: Prompts */}
        <SectionHeader
          eyebrow="Step 2"
          title="Choose your prompts"
          sub="Up to 5. Edit the defaults, type your own, or auto-generate with Groq."
          className="mt-16"
        />

        <PromptsPanel
          count={promptCount}
          onCountChange={setPromptCount}
          prompts={prompts}
          onUpdatePrompt={updatePrompt}
          onResetDefaults={resetPromptsToDefaults}
          onAutoGenerate={autoGenerate}
          generating={generating}
          generateError={generateError}
          canGenerate={canGenerate}
        />

        {/* Section: Run */}
        <SectionHeader
          eyebrow="Step 3"
          title="Run the benchmark"
          sub="Each prompt is sent to every provider in parallel. Results stream in live."
          className="mt-16"
        />

        <RunControls
          canRun={canRun}
          run={run}
          onRun={startBench}
          onReset={() => setRun(INITIAL_RUN)}
          onExport={exportJson}
          totalCalls={prompts.length * (enabledComparisons.length + 1)}
        />

        {(run.status === "running" || run.status === "done") &&
          run.results.length > 0 && (
            <Results
              run={run}
              prompts={prompts}
              ambientModel={ambientModel}
              enabledComparisons={enabledComparisons}
              comparisons={comparisons}
            />
          )}
      </main>

      <Footer />
    </div>
  );
}

/* ---------------- Components ---------------- */

function Nav({
  canRun,
  onRun,
  running,
}: {
  canRun: boolean;
  onRun: () => void;
  running: boolean;
}) {
  return (
    <header className="nav-bar sticky top-0 z-50 border-b border-line-subtle">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-6">
        <a href="#" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            className="block h-[22px] w-[22px] rounded-md shadow-ring"
            style={{
              background:
                "radial-gradient(120% 120% at 0% 0%, #7170ff 0%, #5e6ad2 60%, #2c2f6e 100%)",
              boxShadow:
                "rgba(0,0,0,0.2) 0 0 0 1px, inset 0 1px 0 rgba(255,255,255,0.18)",
            }}
            aria-hidden
          />
          ambient-bench
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          <a
            href="https://app.ambient.xyz"
            target="_blank"
            rel="noreferrer"
            className="btn btn-link"
          >
            Ambient
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <button
            disabled={!canRun}
            onClick={onRun}
            className="btn btn-primary"
          >
            {running ? "Running…" : "Run benchmark →"}
          </button>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden pb-16 pt-24 text-center">
      <div className="hero-glow pointer-events-none absolute inset-x-0 -top-48 h-[700px]" />
      <div className="hero-grid pointer-events-none absolute inset-0" />
      <div className="relative mx-auto max-w-[1100px] px-6">
        <span className="pill mb-7">
          <span
            className="inline-grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-bold text-emerald-950"
            style={{ background: "#10b981" }}
          >
            ★
          </span>
          Verified inference, measured against the rest
        </span>
        <h1 className="mx-auto max-w-[820px] text-[clamp(2.5rem,6vw,4.5rem)] font-medium leading-[1.0] tracking-display text-ink-primary">
          Ambient vs the rest.
          <br />
          <span
            style={{
              background:
                "linear-gradient(180deg, #fff 0%, #b9bce8 70%, #7170ff 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            One bench. Your keys. The truth.
          </span>
        </h1>
        <p className="mx-auto mb-9 mt-5 max-w-[620px] text-[1.0625rem] leading-[1.6] tracking-[-0.165px] text-ink-secondary">
          Run the same prompts through Ambient and any major closed model.
          Records latency, token counts, output, and failure modes per call.
          Bring your own keys. Nothing is logged.
        </p>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  sub,
  className = "",
}: {
  eyebrow: string;
  title: string;
  sub: string;
  className?: string;
}) {
  return (
    <div className={`text-left ${className}`}>
      <span className="overline">{eyebrow}</span>
      <h2 className="mt-2 text-[clamp(1.5rem,3vw,2rem)] font-medium tracking-h1 text-ink-primary">
        {title}
      </h2>
      <p className="mt-2 max-w-[640px] text-[15px] leading-[1.6] text-ink-secondary">
        {sub}
      </p>
    </div>
  );
}

function AmbientCard({
  apiKey,
  onApiKeyChange,
  model,
  onModelChange,
}: {
  apiKey: string;
  onApiKeyChange: (s: string) => void;
  model: string;
  onModelChange: (s: string) => void;
}) {
  const info = PROVIDERS.ambient;
  const filled = apiKey.trim().length > 5;
  return (
    <div
      className="panel-padded"
      style={{
        background:
          "radial-gradient(120% 120% at 0% 0%, rgba(94,106,210,0.18), transparent 60%), rgba(255,255,255,0.02)",
        borderColor: "rgba(113,112,255,0.35)",
        boxShadow: "0 0 0 1px rgba(113,112,255,0.10)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="overline">Required</span>
          <span className="pill" style={{ borderColor: "rgba(113,112,255,0.4)" }}>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: filled ? "#10b981" : "#62666d" }}
            />
            {filled ? "key set" : "key missing"}
          </span>
        </div>
        <a
          href={info.apiKeyHelpUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] text-brand-accent hover:underline"
        >
          Get key →
        </a>
      </div>
      <h3 className="mt-2 text-[1.0625rem] font-semibold text-ink-primary">
        {info.label}
      </h3>
      <p className="mt-1 text-[13px] text-ink-secondary">{info.blurb}</p>

      <label className="field-label mt-4">API key</label>
      <input
        type="password"
        autoComplete="off"
        spellCheck={false}
        placeholder={info.keyPlaceholder}
        value={apiKey}
        onChange={(e) => onApiKeyChange(e.target.value)}
        className="field-input"
      />

      <label className="field-label mt-3">Model</label>
      <select
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        className="field-input"
      >
        {(info.modelOptions ?? [info.defaultModel]).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}

function ComparisonsCard({
  comparisons,
  onToggle,
  onUpdate,
}: {
  comparisons: Record<CmpId, CmpEntry>;
  onToggle: (id: CmpId) => void;
  onUpdate: (id: CmpId, patch: Partial<CmpEntry>) => void;
}) {
  const enabledCount = COMPARISON_IDS.filter(
    (id) => comparisons[id].enabled
  ).length;
  return (
    <div className="panel-padded">
      <div className="flex items-center justify-between">
        <span className="overline">Comparison providers</span>
        <span className="pill">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: enabledCount >= 1 ? "#10b981" : "#d4a13a",
            }}
          />
          {enabledCount} selected · min 1
        </span>
      </div>
      <p className="mt-2 text-[13px] text-ink-secondary">
        Pick any combination. Each enabled provider gets its own key + model.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {COMPARISON_IDS.map((id) => {
          const info = PROVIDERS[id];
          const e = comparisons[id];
          return (
            <button
              key={id}
              onClick={() => onToggle(id)}
              className={`rounded-card border px-3 py-2 text-left text-[13px] transition-colors ${
                e.enabled
                  ? "border-brand bg-[rgba(94,106,210,0.18)] text-ink-primary"
                  : "border-line-primary bg-fill-1 text-ink-secondary hover:border-line-standard hover:bg-fill-2"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{info.label}</span>
                <span
                  className={`h-3 w-3 rounded-full border ${
                    e.enabled
                      ? "border-brand bg-brand-accent"
                      : "border-line-primary"
                  }`}
                />
              </div>
              <span className="mt-0.5 block text-[11px] text-ink-tertiary">
                {info.defaultModel}
              </span>
            </button>
          );
        })}
      </div>

      {enabledCount > 0 && (
        <div className="mt-5 space-y-3">
          {COMPARISON_IDS.filter((id) => comparisons[id].enabled).map((id) => {
            const info = PROVIDERS[id];
            const e = comparisons[id];
            return (
              <div
                key={id}
                className="rounded-card border border-line-primary bg-bg-panel p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-ink-primary">
                      {info.label}
                    </span>
                    <span className="text-[11px] text-ink-tertiary">
                      key required
                    </span>
                  </div>
                  <a
                    href={info.apiKeyHelpUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-brand-accent hover:underline"
                  >
                    Get key →
                  </a>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1.5fr_1fr]">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={info.keyPlaceholder}
                    value={e.apiKey}
                    onChange={(ev) =>
                      onUpdate(id, { apiKey: ev.target.value })
                    }
                    className="field-input"
                  />
                  <select
                    value={e.model}
                    onChange={(ev) => onUpdate(id, { model: ev.target.value })}
                    className="field-input"
                  >
                    {(info.modelOptions ?? [info.defaultModel]).map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PromptsPanel({
  count,
  onCountChange,
  prompts,
  onUpdatePrompt,
  onResetDefaults,
  onAutoGenerate,
  generating,
  generateError,
  canGenerate,
}: {
  count: number;
  onCountChange: (n: number) => void;
  prompts: PromptSpec[];
  onUpdatePrompt: (idx: number, patch: Partial<PromptSpec>) => void;
  onResetDefaults: () => void;
  onAutoGenerate: () => void;
  generating: boolean;
  generateError: string | null;
  canGenerate: boolean;
}) {
  return (
    <div className="panel-padded mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="overline">Count</label>
          <div className="flex items-center gap-0.5 rounded-comfortable border border-line-primary bg-bg-panel p-0.5">
            {Array.from({ length: MAX_PROMPTS }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() => onCountChange(n)}
                className={`h-7 w-9 rounded-[4px] text-[13px] font-medium transition-colors ${
                  count === n
                    ? "bg-brand text-white"
                    : "text-ink-secondary hover:bg-fill-2"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <button onClick={onResetDefaults} className="btn btn-ghost">
            Reset to Week-12 defaults
          </button>
        </div>
      </div>

      {/* Auto-generate row */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-card border border-line-primary bg-bg-panel p-3">
        <button
          onClick={onAutoGenerate}
          disabled={!canGenerate}
          className="btn btn-primary"
        >
          {generating ? "Generating…" : `Auto-generate ${count} prompts`}
        </button>
        <span className="text-[12px] text-ink-tertiary">
          Generates fresh prompts via Groq (Llama-3.3-70B). Replaces all slots.
        </span>
        {generateError && (
          <p className="basis-full text-[12px] text-status-red">{generateError}</p>
        )}
      </div>

      {/* Prompt slots */}
      <ol className="mt-5 space-y-3">
        {prompts.map((p, i) => (
          <PromptSlot
            key={i}
            index={i}
            prompt={p}
            onChange={(patch) => onUpdatePrompt(i, patch)}
          />
        ))}
      </ol>
    </div>
  );
}

function PromptSlot({
  index,
  prompt,
  onChange,
}: {
  index: number;
  prompt: PromptSpec;
  onChange: (patch: Partial<PromptSpec>) => void;
}) {
  const [showMeta, setShowMeta] = useState(false);
  return (
    <li className="rounded-card border border-line-primary bg-bg-panel p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] text-ink-tertiary">
            #{index + 1}
          </span>
          <input
            value={prompt.id}
            onChange={(e) => onChange({ id: e.target.value })}
            className="rounded border border-transparent bg-transparent px-1 py-0.5 font-mono text-[12px] text-ink-secondary hover:border-line-primary focus:border-brand focus:outline-none"
            placeholder="id-slug"
          />
          <span className="text-ink-quaternary">·</span>
          <input
            value={prompt.category}
            onChange={(e) => onChange({ category: e.target.value })}
            className="rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] text-ink-tertiary hover:border-line-primary focus:border-brand focus:outline-none"
            placeholder="category"
          />
        </div>
        <button
          onClick={() => setShowMeta((s) => !s)}
          className="text-[11px] text-ink-tertiary hover:text-ink-primary"
        >
          {showMeta ? "Hide" : "Edit"} keywords
        </button>
      </div>
      <textarea
        value={prompt.prompt}
        onChange={(e) => onChange({ prompt: e.target.value })}
        rows={prompt.prompt.length > 240 ? 5 : 3}
        placeholder="Type your prompt here, or click Auto-generate above."
        className="field-textarea font-mono text-[13px]"
      />
      {showMeta && (
        <div className="mt-2">
          <label className="field-label">
            Expected keywords (comma-separated, used for sanity-check scoring)
          </label>
          <input
            value={(prompt.expectedKeywords ?? []).join(", ")}
            onChange={(e) =>
              onChange({
                expectedKeywords: e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className="field-input"
            placeholder="e.g. quickselect, ValueError, def median"
          />
        </div>
      )}
    </li>
  );
}

function RunControls({
  canRun,
  run,
  onRun,
  onReset,
  onExport,
  totalCalls,
}: {
  canRun: boolean;
  run: RunState;
  onRun: () => void;
  onReset: () => void;
  onExport: () => void;
  totalCalls: number;
}) {
  return (
    <div className="panel-padded mt-6" id="step-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={!canRun}
          onClick={onRun}
          className="btn btn-primary"
        >
          {run.status === "running" ? "Running…" : `Run ${totalCalls} calls →`}
        </button>
        {run.status === "done" && (
          <button onClick={onExport} className="btn btn-ghost">
            Export JSON
          </button>
        )}
        {(run.status === "done" || run.status === "error") && (
          <button onClick={onReset} className="btn btn-ghost">
            Reset
          </button>
        )}
        <span className="text-[12px] text-ink-tertiary">
          Calls run in parallel per prompt. Ambient ≈ 30–280 s per prompt.
        </span>
      </div>
      {run.status === "error" && (
        <div className="mt-4 rounded-card border border-status-red/40 bg-[rgba(229,72,77,0.08)] p-3 text-[13px] text-status-red">
          {run.errorMessage}
        </div>
      )}
    </div>
  );
}

function Results({
  run,
  prompts,
  ambientModel,
  enabledComparisons,
  comparisons,
}: {
  run: RunState;
  prompts: PromptSpec[];
  ambientModel: string;
  enabledComparisons: CmpId[];
  comparisons: Record<CmpId, CmpEntry>;
}) {
  const totalCells = prompts.length * (enabledComparisons.length + 1);
  const completed = run.results.length;
  const pct = Math.round((completed / Math.max(1, totalCells)) * 100);

  const providerOrder: { id: "ambient" | CmpId; label: string; model: string }[] = [
    {
      id: "ambient",
      label: PROVIDERS.ambient.label,
      model: ambientModel,
    },
    ...enabledComparisons.map((id) => ({
      id,
      label: PROVIDERS[id].label,
      model: comparisons[id].model,
    })),
  ];

  const stats = useMemo(() => {
    const map = new Map<string, ReturnType<typeof summarize>>();
    for (const p of providerOrder) {
      const rows = run.results.filter((r) => r.provider === p.id);
      map.set(p.id, summarize(rows));
    }
    return map;
  }, [run.results, providerOrder]);

  return (
    <section className="mt-12">
      <SectionHeader
        eyebrow="Results"
        title="Side-by-side"
        sub={`${completed}/${totalCells} calls · ${pct}%`}
      />

      <div className="mt-4 h-1 w-full overflow-hidden rounded bg-bg-surface3">
        <div
          className="h-full transition-all"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, #5e6ad2, #7170ff)",
          }}
        />
      </div>

      {/* Aggregate */}
      <div className="mt-6 overflow-x-auto rounded-panel border border-line-standard">
        <table className="min-w-full divide-y divide-line-subtle text-[13px]">
          <thead className="bg-bg-panel">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium text-ink-tertiary">Provider</th>
              <th className="px-3 py-2 font-medium text-ink-tertiary">Model</th>
              <th className="px-3 py-2 font-medium text-ink-tertiary">Calls</th>
              <th className="px-3 py-2 font-medium text-ink-tertiary">Failures</th>
              <th className="px-3 py-2 font-medium text-ink-tertiary">Median latency</th>
              <th className="px-3 py-2 font-medium text-ink-tertiary">Avg out tokens</th>
              <th className="px-3 py-2 font-medium text-ink-tertiary">Keyword hits</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle text-ink-primary">
            {providerOrder.map((p) => {
              const s = stats.get(p.id)!;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium">{p.label}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-ink-tertiary">
                    {p.model}
                  </td>
                  <td className="px-3 py-2">{s.count}</td>
                  <td className="px-3 py-2">
                    {s.failures > 0 ? (
                      <span className="text-status-red">{s.failures}</span>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {s.medianLatencyMs == null
                      ? "—"
                      : `${(s.medianLatencyMs / 1000).toFixed(1)}s`}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {s.avgOutTokens == null
                      ? "—"
                      : `${s.avgEstimated ? "~" : ""}${s.avgOutTokens}`}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {s.keywordTotal === 0
                      ? "—"
                      : `${s.keywordHits}/${s.keywordTotal}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Per-prompt cards */}
      <div className="mt-6 space-y-4">
        {prompts.map((p) => (
          <PromptResultCard
            key={p.id}
            prompt={p}
            providerOrder={providerOrder}
            results={run.results.filter((r) => r.promptId === p.id)}
          />
        ))}
      </div>
    </section>
  );
}

function summarize(rows: CallResult[]) {
  const ok = rows.filter((r) => !r.error);
  const failures = rows.length - ok.length;
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const medianLatencyMs =
    latencies.length === 0 ? null : latencies[Math.floor(latencies.length / 2)];
  const totalOut = ok.reduce((s, r) => s + (r.outputTokens ?? 0), 0);
  const avgOutTokens =
    ok.length === 0 ? null : Math.round(totalOut / ok.length);
  const avgEstimated = ok.some((r) => r.tokensEstimated);
  let keywordHits = 0;
  let keywordTotal = 0;
  for (const r of ok) {
    keywordHits += r.keywordHits?.length ?? 0;
    keywordTotal +=
      (r.keywordHits?.length ?? 0) + (r.keywordMissed?.length ?? 0);
  }
  return {
    count: rows.length,
    failures,
    medianLatencyMs,
    avgOutTokens,
    avgEstimated,
    keywordHits,
    keywordTotal,
  };
}

function PromptResultCard({
  prompt,
  providerOrder,
  results,
}: {
  prompt: PromptSpec;
  providerOrder: { id: "ambient" | CmpId; label: string; model: string }[];
  results: CallResult[];
}) {
  return (
    <div className="rounded-panel border border-line-standard bg-fill-1">
      <div className="border-b border-line-subtle px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12px] text-ink-secondary">
            {prompt.id}
          </span>
          <span className="overline">{prompt.category}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[13px] text-ink-tertiary">
          {prompt.prompt}
        </p>
      </div>
      <div
        className="grid divide-y divide-line-subtle md:divide-x md:divide-y-0"
        style={{
          gridTemplateColumns: `repeat(${providerOrder.length}, minmax(0, 1fr))`,
        }}
      >
        {providerOrder.map((p) => {
          const r = results.find((x) => x.provider === p.id);
          return <ResultPanel key={p.id} label={p.label} result={r} />;
        })}
      </div>
    </div>
  );
}

function ResultPanel({
  label,
  result,
}: {
  label: string;
  result?: CallResult;
}) {
  if (!result) {
    return (
      <div className="px-4 py-3 text-[13px] text-ink-quaternary">
        <div className="font-medium text-ink-secondary">{label}</div>
        <div className="mt-1 text-[12px]">Pending…</div>
      </div>
    );
  }
  const isError = !!result.error;
  return (
    <div className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-medium text-ink-primary">{label}</div>
        <div className="font-mono text-[11px] text-ink-tertiary">
          {result.model}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-tertiary">
        <span>
          {isError ? (
            <span className="text-status-red">
              ✗ {result.failureMode ?? "error"}
            </span>
          ) : (
            <span style={{ color: "#10b981" }}>✓ ok</span>
          )}
        </span>
        <span className="font-mono">
          {(result.latencyMs / 1000).toFixed(1)}s
        </span>
        {result.outputTokens != null && (
          <span className="font-mono">
            {result.tokensEstimated ? "~" : ""}
            {result.outputTokens} out
          </span>
        )}
        {result.keywordHits && (
          <span className="font-mono">
            kw {result.keywordHits.length}/
            {result.keywordHits.length + (result.keywordMissed?.length ?? 0)}
          </span>
        )}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] text-ink-tertiary hover:text-ink-secondary">
          {isError ? "Error details" : "Show output"}
        </summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-bg-deepest p-3 text-[12px] leading-relaxed text-ink-secondary">
          {isError ? result.error : result.output}
        </pre>
      </details>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line-subtle">
      <div className="mx-auto max-w-[1100px] px-6 py-10 text-[13px] text-ink-tertiary">
        <p>
          Built for Ambient testnet Week 12 — &ldquo;Signal vs Noise.&rdquo; CLI
          version of the same benchmark in{" "}
          <code className="font-mono text-ink-secondary">
            dev-loop/ambient-bench/
          </code>
          .
        </p>
        <p className="mt-2 text-ink-quaternary">
          Keys flow only through this app&apos;s <code>/api/bench</code> route to
          call providers. They are not stored, logged, or sent anywhere else.
        </p>
      </div>
    </footer>
  );
}
