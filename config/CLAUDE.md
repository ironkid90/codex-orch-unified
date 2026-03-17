# config — Configuration & Schemas

**Environment-aware configuration layer managing provider selection, model fallback chains, MCP registry, and API key management.**

## Key Files

- **model-routing.json** — Provider selection matrix; each role (research, worker1, evaluator) has primary + fallback provider chain with model mappings
- **model-capabilities.json** — Capability registry; maps models to supported tools (vision, tool_use, etc.)
- **.env.example** — Template for required env vars (API keys, provider URLs, registry paths)
- **graph-schemas/** — JSON schema validators for workflow definitions
- **.env.local** (machine-local, gitignored) — Actual secrets and runtime overrides

## Architecture

Configuration is **hierarchical**: defaults in code → model-routing.json (version-controlled) → graph-schemas/ (workflow validation) → .env.local (secrets, machine-specific overrides). **Provider selection** is resolved per-role by reading SWARM_RESEARCH_PROVIDER (etc.) env vars, falling back to model-routing.json. **MCP settings** are loaded from mcp-settings.json, which lists Docker registry servers and direct server connections.

**Model capabilities** are resolved at runtime: each model has a capability profile (supportsTools, supportsVision, contextWindow) stored in model-capabilities.json. The control-center validates all required env vars before run start.

## Key Config Sections

- **Provider selection** — SWARM_RESEARCH_PROVIDER, SWARM_WORKER1_PROVIDER, SWARM_EVALUATOR_PROVIDER (openai, anthropic, ollama, etc.)
- **API keys** — OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OLLAMA_BASE_URL
- **MCP registry** — mcp-settings.json (Docker registries, direct servers, stdio connections)
- **Model routing** — Fallback chains in model-routing.json; automatic retry on provider failure

## Known Issues

- **.kilocode/mcp.json contains a GitHub PAT—SECURITY RISK.** Rotate token immediately; add .kilocode/ to .gitignore.
- **.gitignore has merge-conflict markers** (lines 63–67); resolve to enable proper ignores
- Config hot-reload not supported; orchestrator restarts required for changes to take effect
- Fallback chains lack weighting; no cost-aware or latency-aware routing yet

## Recent Changes

- Unified MCP settings loading: config/mcp-settings.json now authoritative for Docker registry + direct servers
- Control-center preflight validation: detects missing env vars before run start
- Model routing: Support for model-specific capabilities (vision, tool_use context windows)
- Schema validation: graph-schemas/ now enforced at workflow load time

## Quick Navigation

← **[lib/swarm/CLAUDE.md](../lib/swarm/CLAUDE.md)** — Reads config at startup  
← **[lib/providers/CLAUDE.md](../lib/providers/CLAUDE.md)** — Uses provider + API key config  
→ **[app/CLAUDE.md](../app/CLAUDE.md)** — Control-center UI for interactive config setup
