# Multi-Agent Project Dependencies

## Runtime stack (current)

- `next@^14.2.16`
- `react@^18.3.1`
- `react-dom@^18.3.1`
- `typescript@^5.6.3`
- `tsx@^4.20.6` (CLI execution for setup/run/deploy tooling)
- `openai@^4.68.1` (OpenAI API client)
- `zod@^3.25.76` (runtime schema validation)
- `ajv@^8.17.1` (JSON schema validation for batch pipeline)
- `@modelcontextprotocol/sdk@^1.27.1` (MCP protocol client)
- `dotenv@^16.4.5` (environment variable loading)
- `@types/node`, `@types/react`, `@types/react-dom`

## Built-in platform primitives used

- Node `child_process`: agent/lint/research subprocess execution
- Node `fs/promises`: checkpointing, artifact and message persistence
- Node `crypto`: SHA-256 integrity hashes for structured messages
- Node `events`: in-memory realtime event fan-out

## Tooling contracts

- `codex` CLI: local agent execution in `local` mode
- `npm run lint`: lint loop gate (configured as `tsc --noEmit`)
- `npm run build`: production validation gate
- `rg` (optional but preferred): local research search acceleration
- External web research adapter:
  - Bing RSS endpoint (no API key)
  - Tavily Search API (`TAVILY_API_KEY` required)
- `npx vercel`: one-click preview/production deploy
- `gcloud` (optional): Google ADC token retrieval for Gemini auth

## Optional future dependencies

- OpenTelemetry SDK (trace export)
- Graph workflow engine library (if replacing current imperative loop)
- Python/.NET Agent Framework SDKs for cross-language orchestration parity
