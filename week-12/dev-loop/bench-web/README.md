# bench-web

> Web UI for `ambient-bench`. Bring your own API keys and run the same prompts
> through Ambient and one major closed model side-by-side.

Companion to the CLI at `../ambient-bench/`. Same provider abstraction, same
default prompt set, same metrics — but accessible to anyone with a browser
and an API key.

## Features

- **Ambient required**, plus one of: OpenAI, Claude, Gemini, DeepSeek, GLM (Zhipu), Kimi (Moonshot)
- **Streaming results** — each call's outcome appears live as it completes
- **Per-call metrics**: latency (ms), input/output tokens, full output, failure mode
- **Aggregate table**: median latency, average output tokens, keyword hit rate
- **Export** the run as JSON for archival or further analysis

## Privacy

Keys are sent to this app's `/api/bench` route only to make the API calls.
They are not logged, persisted, or sent anywhere else. The API route holds
them in memory for the duration of one request and that's it.

If you don't trust the deployment, run the app locally — see below.

## Run locally

```bash
cd week-12/dev-loop/bench-web
npm install
npm run dev
# open http://localhost:3000
```

## Deploy

Deploy to Netlify, Vercel, or any Next.js-compatible host. The `/api/bench`
route uses streaming responses (NDJSON) so the host needs to support that —
Netlify and Vercel both do.

Set `maxDuration = 300` is hardcoded in the route. Free tiers may cap function
execution time below that; if so, expect Ambient calls on long prompts to be cut
off mid-stream. The CLI version doesn't have this limit.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS
- Native `fetch` for provider calls (no SDK bundling overhead)
- NDJSON streaming for live results

## Limitations / honest caveats

- **No retries.** A single rate-limit kills that prompt for that provider in one run. Reload and re-run if needed.
- **No persistence.** Results live only in browser state until you export.
- **Anthropic uses `/v1/messages`** (not OpenAI-compatible), handled separately. Other providers go through their OpenAI-compatible endpoints.
- **Token counts are estimated** (`chars/4`) when the provider omits `response.usage`. Estimated values are prefixed with `~` everywhere they appear. Currently this affects Ambient, which doesn't return a usage block.
