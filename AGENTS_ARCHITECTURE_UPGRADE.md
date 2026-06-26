# Codex Orchestrator — Unified Architecture Design

## 1. Smart Orchestrator & Tool Registry

The orchestrator currently has a tool-aware loop (`runUnifiedProviderTask` in `engine.ts`) but it is restricted to a hardcoded set of providers (`openai`, `anthropic`, `ollama`).

### 1.1 Goal
Make the orchestrator fully automatic and tool-aware for *all* providers, including custom APIs and OpenAI-compatible endpoints.

### 1.2 Implementation
- **Remove Provider Constraint:** Update `ProviderId` in `model-routing.ts` and `types.ts` to allow `openai-compatible`, `azure-openai`, and custom API endpoints.
- **Unified Tool Dispatch:** Update `runProviderTask` in `engine.ts` to route all non-legacy (`codex`, `gemini`) tasks through `runUnifiedProviderTask`.
- **Dynamic Config:** Update `buildUnifiedProviderConfig` to pull from the dynamic `auth-manager.ts` state instead of just `process.env`.

## 2. API Key Management & Custom API Support

The current settings UI and `auth-manager.ts` only support a fixed set of providers with a single token input.

### 2.1 Goal
Support custom APIs, custom base URLs, and full OAuth login flows (especially for OpenAI/Claude endpoints).

### 2.2 Implementation
- **Extend Auth State:** Update `ProviderTokenEntry` in `auth-manager.ts` to hold `customProviders: Record<string, ProviderConfig>`.
- **API Updates:** Update `POST /api/auth/[provider]` to accept full `ProviderConfig` objects (including `baseUrl`, `customHeaders`, `oauthInitiate`).
- **Factory Updates:** Update `createProviderFromEnv` in `factory.ts` to read from the dynamic auth state.

## 3. UI Polish & OAuth Integration

The settings UI currently uses fixed cards (`OpenAIAuthSettings`, etc.) that are display-only.

### 3.1 Goal
Provide a flexible UI for configuring built-in providers, adding custom APIs, and initiating OAuth flows.

### 3.2 Implementation
- **Settings UI:** Build a dynamic `ProviderSettingsForm` in `ProviderAuthCard.tsx` that exposes inputs for Base URL, Custom Headers, and API Key.
- **Custom API Panel:** Add an "Add Custom API" button to the `ProviderStatusInventory`.
- **OAuth Buttons:** Add "Login with OAuth" buttons for providers that support it, mapping to the `oauthInitiate` API flow.

## 4. Sub-project Integration

The user mentioned combining 4 projects. The recent upgrade added Kanban, Pentest, Agents, and Memory panels. We need to ensure they are all wired up seamlessly.

### 4.1 Goal
Ensure all dashboard panes (`kanban`, `pentest`, etc.) share the same unified context, tool registry, and auth state.

### 4.2 Implementation
- **Verify Routing:** Ensure `layout-state.ts` and `page.tsx` correctly persist and restore the new panes.
- **Context Sharing:** Ensure the Kanban and Pentest APIs can access the `ProviderAuthManager` to dispatch tasks to agents.
