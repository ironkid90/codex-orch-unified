# lib/providers — Provider & Model Routing

**Multi-provider LLM abstraction layer supporting OpenAI, Anthropic, Gemini, Ollama, and Azure with dynamic fallback and authentication routing.**

## Key Files

- **factory.ts** — Provider instantiation; environment-based selection (SWARM_RESEARCH_PROVIDER, etc.)
- **types.ts** — Unified Provider interface (chat, embed, vision methods); ProviderConfig, Message, ToolCall definitions
- **auth.ts** — Credential resolution (API keys, OAuth, service accounts, Codex session tokens)
- **openai-provider.ts** — OpenAI and Azure OpenAI implementation
- **anthropic-provider.ts**, **ollama-provider.ts** — Multi-provider support

## Architecture

Providers are instantiated via **factory.ts** based on environment config (provider type + model name). Each provider implements a **unified chat interface** (message history, tool calls, streaming). Authentication is lazy-loaded and environment-aware (API keys via .env, OAuth via credential helpers, service account files).

**Fallback logic** is managed in **model-routing.json** (config/), where each role (research, worker1, evaluator) can specify primary + fallback provider chains. If the primary fails, the orchestrator retries with the next in the chain. Tool definitions are normalized to a provider-agnostic format before being passed to LLMs.

## Design Patterns

- **Lazy credential initialization** — Secrets resolved on first provider creation, not startup
- **Provider interface consistency** — All providers implement chat/embed methods with identical signatures
- **Error recovery** — Fallback chains reduce dependency on single provider; transient failures trigger automatic retry
- **Stream & non-stream paths** — Both supported; consumers choose based on use case

## Known Issues

- Provider interface evolving (some edges have Model A vs Model B variant handling)
- Anthropic provider v1→v2 API transition in progress; some method signatures differ
- Ollama local-only; no Docker registry support yet

## Recent Changes

- Unified auth setup: consolidated credential resolution paths across all providers
- Improved error reporting: missing API keys now yield actionable messages vs. cryptic failures
- Azure OpenAI: baseUrl resolution from AZURE_ENDPOINT env var
- Streaming support: unified streaming interface across OpenAI, Anthropic, Ollama

## Quick Navigation

← **[lib/swarm/CLAUDE.md](../swarm/CLAUDE.md)** — Orchestrator that uses providers  
→ **[config/CLAUDE.md](../../config/CLAUDE.md)** — Provider selection and fallback chains
