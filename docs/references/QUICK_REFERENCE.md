# Codex-Orch Workspace Quick Reference

## 🎯 What This Repo Does

**Multi-agent swarm orchestrator** for AI-driven code generation and analysis with:
- 5 agents (Research, Worker-1, Worker-2, Evaluator, Coordinator) running in fan-out/fan-in loops
- Real-time dashboard showing execution progress
- Checkpoint/recovery system for fault tolerance
- Code indexing and search via MCP server

---

## 📦 Projects at a Glance

| Project | Type | Purpose | Key Location |
|---------|------|---------|--------------|
| **codex-orch** | Next.js | Main orchestrator + web dashboard | `lib/swarm/engine.ts`, `app/` |
| **code-index-mcp** | Python MCP | Code indexing & search for LLMs | `code-index-mcp/src/` |
| **swiss-knife-temp** | FastAPI | Local MCP bridge for Codex CLI | `swiss-knife-temp/` |
| **multi-codex** | Vite/SolidJS | Alt dashboard (secondary) | `multi-codex/src/` |

---

## 🔧 Quick Build Commands

```bash
# Node.js (root)
npm install
npm run dev                    # Start localhost:3000
npm run swarm:run              # CLI mode
npm run lint                   # TypeScript check
npm run build                  # Production build
npm run swarm:deploy           # Vercel deploy

# PowerShell
.\run-swarm.ps1                # Interactive CLI
.\run-swarm.ps1 -Setup         # Auth setup
.\run-swarm.ps1 -Deploy        # Deploy

# Python (code-index-mcp)
cd code-index-mcp
uv sync
pytest -q

# Docker
docker build -t codexorch .
docker-compose up -d
```

---

## 📁 Where to Find Things

| Question | Answer | File |
|----------|--------|------|
| How does orchestration work? | Event loop driving 5 agents with fan-out/fan-in | `lib/swarm/engine.ts` |
| WWhat are the data types? | AgentId, AgentPhase, RoundStatus, SwarmRunState | `lib/swarm/types.ts` |
| How are messages logged? | JSONL format in runs/round-*/messages.jsonl | `runs/round-1/messages.jsonl` |
| How is execution streamed to UI? | SSE at /api/swarm/stream | `app/api/swarm/stream` |
| How does code indexing work? | Tree-sitter AST + file watcher | `code-index-mcp/src/` |
| What's the prompt format? | Markdown in prompts/ directory | `prompts/research.md` |
| How to checkpoint/recover? | Automatic per-round in runs/checkpoints/ | `lib/swarm/engine.ts` |
| How to control execution? | pause/resume/rewind via /api/swarm/control | `app/api/swarm/control` |
| How tests run? | Playwright E2E in output/playwright/ | `package.json` (Playwright) |
| TypeScript config? | ES2022 target, strict mode, path aliases | `tsconfig.json` |

---

## 🛠️ Core Technologies

### Frontend
- **Next.js 16.1.6** - Server + client framework
- **React 19.2.4** - UI components
- **TypeScript 5.8.3** - Type-safe code
- **Playwright 1.58.2** - E2E testing

### Backend / Orchestration
- **Node.js** - Runtime
- **child_process** - Spawn Codex/research subprocesses
- **fs/promises** - Checkpoint/artifact persistence
- **EventEmitter** - Real-time event streaming
- **crypto.createHash** - SHA-256 integrity

### External Integrations
- **Gemini API** - Research agent (optional)
- **Codex CLI** - Worker agent execution
- **Vercel** - Zero-config deployment
- **Google Cloud ADC** - Application Default Credentials

### Python
- **MCP 1.21+** - Model Context Protocol
- **FastAPI** - HTTP server (swiss-knife-temp)
- **tree-sitter** - AST parsing (7 languages)
- **watchdog** - File watcher for auto-refresh
- **Pydantic** - Data validation

---

## 📊 Execution Flow

```
┌─────────────┐
│   START     │
└──────┬──────┘
       │
       ▼
┌──────────────────┐
│ ROUND N BEGINS   │
└──────┬───────────┘
       │
       ├─► Research (context gathering)
       ├─► Worker-1 (implementation)
       ├─► Worker-2 (auditor - conditional)
       ├─► Evaluator (feedback)
       └─► Coordinator (voting/decision)
           │
           ├─► LINT CHECK
           │
           └─► Checkpoint
               │
               ├─ PASS → Next round
               ├─ REVISE → Try again
               └─ FAIL → Can rewind

```

---

## 🔑 Environment Variables

```bash
# Execution
SWARM_CODEX_BIN=codex              # Path to Codex CLI
NODE_ENV=production|development

# Gemini API (optional)
SWARM_RESEARCH_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-pro
GOOGLE_USE_ADC=1                   # Use gcloud auth

# Debugging
DEBUG=*                            # Enable verbose logs
```

---

## 🧪 Testing Strategy

| Test Type | Framework | Location | Command |
|-----------|-----------|----------|---------|
| E2E | Playwright | `output/playwright/` | `npm test` |
| Type Check | TypeScript | Root | `npm run lint` |
| Production Build | Next.js | Root | `npm run build` |
| Python Unit | pytest | `code-index-mcp/tests/` | `pytest -q` |

---

## 📡 API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/swarm/start` | POST | Start a new swarm run |
| `/api/swarm/state` | GET | Get current run state |
| `/api/swarm/stream` | GET (SSE) | Stream live events |
| `/api/swarm/control` | POST | pause/resume/rewind |

---

## 🎨 Code Patterns Checklist

- ✅ Strict TypeScript (`strict: true`)
- ✅ Typed error handling (try-catch with context)
- ✅ Async/await for I/O
- ✅ Service-oriented architecture (Python)
- ✅ EventEmitter for real-time updates
- ✅ Discriminated unions for state types
- ✅ Deterministic parsing (regex, not LLM)
- ✅ Path aliasing (`@/*`)
- ✅ Feature flags (SwarmFeatures interface)
- ✅ Message integrity (SHA-256)

---

## 🚀 Common Tasks

### Run a single swarm round locally
```bash
npm run swarm:run -- --mode local --max-rounds 1
```

### Set up MCP for a project
```bash
cd code-index-mcp
uvx code-index-mcp --project-path /path/to/repo
```

### Debug a failed agent
1. Open `runs/round-N/agent-name.md`
2. Check `runs/round-N/messages.jsonl` for errors
3. Review parsing logic in `lib/swarm/parse.ts`

### Deploy to Vercel
```bash
npm run swarm:deploy -- --prod
# or
npm run swarm:deploy  # preview
```

### Rewind execution
1. Pause via dashboard
2. Click "Rewind to Round N"
3. Resume to continue from checkpoint

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| `README.md` | High-level overview |
| `AGENTS_ARCHITECTURE.md` | Agent topology and lifecycle |
| `AGENTS_KNOWLEDGE.md` | Agent knowledge base |
| `AGENTS_ROADMAP.md` | Future planning |
| `DEPENDENCIES.md` | Tech stack breakdown |
| `WORKSPACE_EXPLORATION.md` | This detailed analysis |

---

## 🔗 Key Files for Development

```
Critical Path:
├── lib/swarm/engine.ts              # Core orchestration
├── lib/swarm/types.ts               # Type contracts
├── lib/swarm/parse.ts               # Output parsing
├── lib/swarm/store.ts               # State management
├── app/page.tsx                     # Dashboard UI
├── app/api/swarm/                   # API routes
└── scripts/swarm-cli.ts             # CLI entry point

Data Flow:
├── prompts/                         # Agent instructions
├── runs/round-*/messages.jsonl      # Message log
├── runs/checkpoints/                # Recovery points
└── output/                          # Test artifacts
```

---

Last Updated: 2026-02-17
