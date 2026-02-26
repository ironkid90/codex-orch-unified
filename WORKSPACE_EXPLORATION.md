# Codex-Orch Workspace Exploration Report

## 1. Main Projects and Their Purposes

### **A. codex-orch (Root Project)**
**Purpose**: Multi-agent swarm orchestrator with live dashboard
- **Type**: Next.js 16.1.6 full-stack application
- **Core Function**: Orchestrates fan-out/fan-in execution loops with 5 agents (Research, Worker-1, Worker-2, Evaluator, Coordinator)
- **Key Features**:
  - SSE real-time streaming at `/api/swarm/stream`
  - State API snapshots at `/api/swarm/state`
  - Control plane for pause/resume/rewind at `/api/swarm/control`
  - Execution modes: `local` (subprocess) and `demo` (simulation)
  - Checkpoint recovery system in `runs/checkpoints/`
  - Structured message logging in `runs/round-*/messages.jsonl`

### **B. code-index-mcp** (`code-index-mcp/`)
**Purpose**: Model Context Protocol server for code indexing and analysis
- **Type**: Python 3.10+ MCP server
- **Core Function**: Bridges AI models and complex codebases with intelligent indexing, search, and analysis
- **Key Components**:
  - `src/code_index_mcp/services/` - Domain-specific service layer (FileService, SearchService, CodeIntelligenceService, etc.)
  - `src/code_index_mcp/indexing/` - Index building strategies
  - `src/code_index_mcp/search/` - Search implementation with ugrep, ripgrep, ag, grep support
  - Tree-sitter AST parsing for 7 languages (Python, JavaScript, TypeScript, Java, Go, Objective-C, Zig)
  - File watcher for automatic index updates (`watchdog` library)
  - Persistent caching system

### **C. swiss-knife-temp** (`swiss-knife-temp/`)
**Purpose**: Local MCP server and stdio bridge for Codex CLI
- **Type**: Python FastAPI + uvicorn server
- **Core Function**: Provides local MCP capabilities and bridges Codex CLI commands
- **Key Endpoints**:
  - FastAPI-based HTTP server
  - MCP server registration via stdio
  - Configuration management

### **D. multi-codex** (`multi-codex/`)
**Purpose**: Vite-based interactive dashboard (secondary UI)
- **Type**: SolidJS 1.x frontend
- **Platform**: React-router based single-page app
- **Styling**: Tailwind CSS
- **Note**: The primary dashboard is in the root `app/` (Next.js)

### **E. my-app** (`my-app/`)
**Purpose**: Vite project template/test app
- **Type**: React + TypeScript frontend
- **Status**: Appears to be a template or test application

---

## 2. Build Tools and Scripts

### **Node.js Project Configuration**

#### **Root package.json**
```json
{
  "dependencies": {
    "@playwright/test": "^1.58.2"
  }
}
```
- **Minimal direct dependencies** (Playwright for E2E testing)
- Main app dependencies managed via Next.js defaults

#### **Available npm/pnpm Scripts** (inferred from README and codebase)
```bash
npm install              # Install dependencies
npm run dev              # Start development server (localhost:3000)
npm run swarm:setup      # Bootstrap auth/API configuration
npm run swarm:run        # Execute swarm with local Codex CLI
npm run lint            # Lint check (configured as 'tsc --noEmit')
npm run build           # Production build validation
npm run swarm:deploy    # One-click Vercel preview deploy
```

#### **PowerShell CLI Scripts**
```powershell
.\run-swarm.ps1              # Advanced CLI mode
.\run-swarm.ps1 -Setup       # Auth/API setup
.\run-swarm.ps1 -Deploy      # One-click Vercel preview deploy
.\run-swarm.ps1 -Legacy      # Direct script path (legacy)
```

**Interactive terminal controls during `swarm:run`:**
```
pause                    # Pause execution
resume                   # Resume paused run
rewind <round>           # Rewind to specific round
status                   # Show current status
```

### **Python Projects Configuration**

#### **code-index-mcp**: `pyproject.toml` (setuptools)
```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "code-index-mcp"
version = "2.13.0"
requires-python = ">=3.10"

[project.scripts]
code-index-mcp = "code_index_mcp.server:main"  # Entry point
```

**Key Dependencies:**
- `mcp>=1.21.0,<2.0.0` - Model Context Protocol
- `watchdog>=3.0.0` - File system monitoring
- `tree-sitter>=0.20.0` + language bindings - AST parsing
- `pathspec>=0.12.1` - .gitignore pattern matching
- `msgpack>=1.0.0` - Binary serialization

**Installation Command:**
```bash
uv sync                  # Recommended: universal package manager
pip install code-index-mcp  # Traditional install
```

#### **swiss-knife-temp**: `pyproject.toml` (setuptools)
```toml
[project]
name = "ai-agents-swiss-knife"
version = "0.2.0"
requires-python = ">=3.10"

[project.scripts]
ai-agents-swiss-knife-server = "server.mcp_server:main"
ai-agents-swiss-knife-bridge = "server.mcp_bridge:main"
```

**Key Dependencies:**
- `fastapi` - Web framework
- `uvicorn` - ASGI server
- `pydantic` - Data validation
- `openpyxl` - Excel file handling

### **Docker Configuration**

#### **Root Dockerfile** (Node.js)
```dockerfile
FROM node:lts-alpine
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY ["package.json", "package-lock.json*", "npm-shrinkwrap.json*", "./"]
RUN npm install --production --silent && mv node_modules ../
COPY . .
EXPOSE 3000
RUN chown -R node /usr/src/app
USER node
CMD ["npm", "start"]
```

#### **Docker Compose** (`compose.yaml`)
```yaml
services:
  codexorchdashboard:
    image: codexorchdashboard
    build:
      context: .
      dockerfile: ./Dockerfile
    environment:
      NODE_ENV: production
    ports:
      - 3000:3000
```

**Debug variant** (`compose.debug.yaml`):
- `DEBUG=*` environment variable
- Development mode enabled

### **TypeScript Configuration** (`tsconfig.json`)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "es2022"],
    "allowJs": false,
    "strict": true,
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]     // Path aliasing for imports
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "runs", "swiss-knife-temp", "swiss-knife-venv"]
}
```

**Key Settings:**
- Strict TypeScript (`strict: true`)
- No JavaScript allowed (`allowJs: false`)
- Module resolution set to "Bundler" (Next.js recommendation)
- Path aliasing: `@/*` points to project root

---

## 3. Testing Setup

### **E2E Testing**
- **Framework**: Playwright 1.58.2
- **Located**: `output/playwright/dashboard-check/`
- **Setup**: Located in root `package.json` as dependency

### **Python Testing** (code-index-mcp)
**Test Structure:**
```
code-index-mcp/
├── tests/
│   ├── indexing/    # Indexing tests
│   ├── search/      # Search tests
│   ├── services/    # Service layer tests
│   ├── strategies/  # Parsing strategy tests
│   ├── utils/       # Utility tests
│   └── test_server_config.py
├── test/
│   ├── README.md
│   ├── sample-projects/  # Test fixtures
```

**Test Execution** (inferred):
```bash
pytest -q              # Run tests quietly
pytest tests/          # Run specific test suite
```

### **No Explicit Unit Tests for Node/TypeScript**
- Focus on integration testing via Playwright
- CI/CD validation via `npm run lint` (TypeScript compilation check)
- Production validation via `npm run build`

---

## 4. Coding Patterns

### **A. TypeScript/Node.js Patterns**

#### **Type Safety First**
[File: lib/swarm/types.ts](lib/swarm/types.ts#L1)
```typescript
export type AgentId = "research" | "worker1" | "worker2" | "evaluator" | "coordinator";
export type AgentPhase = "idle" | "queued" | "running" | "completed" | "failed";
export type PdaStage = "perceive" | "decide" | "act";

export interface AgentState {
  id: AgentId;
  label: string;
  phase: AgentPhase;
  round: number;
  startedAt?: string;
  outputFile?: string;
  excerpt?: string;
}
```

**Pattern:** Discriminated unions and strict interfaces for state management

#### **Async/Await with Error Handling**
[File: lib/swarm/engine.ts](lib/swarm/engine.ts#L154)
```typescript
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runProcess(command: string, args: string[]): Promise<CmdResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args);
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => stdout += d);
    child.stderr?.on("data", (d) => stderr += d);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", reject);  // Explicit error propagation
  });
}
```

**Pattern:** Promise-based error handling with explicit rejection

#### **EventEmitter for Real-time Updates**
[File: lib/swarm/store.ts](lib/swarm/store.ts#L1)
```typescript
class SwarmStore {
  private readonly emitter = new EventEmitter();
  
  subscribe(listener: (event: SwarmEvent) => void): () => void {
    this.emitter.on("event", listener);
    return () => this.emitter.off("event", listener);  // Unsubscribe function
  }
}
```

**Pattern:** Observer pattern with cleanup (unsubscribe returns function)

#### **Deterministic Parsing and Verification**
[File: lib/swarm/parse.ts](lib/swarm/parse.ts#L1)
```typescript
function capture(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[1]?.trim();
}

export function parseCoordinatorStatus(text: string): RoundStatus {
  const status = capture(text, /STATUS:\s*(PASS|REVISE|FAIL)/i)?.toUpperCase();
  if (status === "PASS" || status === "REVISE" || status === "FAIL") {
    return status;
  }
  return "RUNNING";
}
```

**Pattern:** Type-safe parsing with regex fallback to safe default

#### **React Patterns** (Next.js)
[File: app/page.tsx](app/page.tsx#L1)
```typescript
"use client";  // Client component marker

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SwarmRunState, AgentState } from "@/lib/swarm/types";

export default function HomePage() {
  const [state, setState] = useState<SwarmRunState | null>(null);
  const [busy, setBusy] = useState(false);
  
  const loadState = useCallback(async () => {
    const res = await fetch("/api/swarm/state", { cache: "no-store" });
    const data = (await res.json()) as StateResponse;
    setState(data.state);
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);
}
```

**Patterns:**
- `"use client"` directive for client-side rendering
- Typed fetch responses (`as StateResponse`)
- `useCallback` for memoized callbacks
- State lifted management pattern

#### **CLI Argument Parsing**
[File: scripts/swarm-cli.ts](scripts/swarm-cli.ts#L1)
```typescript
function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > -1) {
      flags.set(arg.slice(0, eq), arg.slice(eq + 1));
      continue;
    }
  }
  return { command, flags, positionals };
}

function flagBoolean(flags: Map<string, string | boolean>, key: string, fallback = false): boolean {
  const value = flags.get(key);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() !== "false";
  return fallback;
}
```

**Pattern:** Type-safe flag parsing with fallback values

---

### **B. Python Patterns (code-index-mcp)**

#### **Service-Oriented Architecture**
[File: code-index-mcp/src/code_index_mcp/server.py](code-index-mcp/src/code_index_mcp/server.py#L1)
```python
class FIFOConcurrencyLimiter:
    """FIFO queue-based concurrency limiter with timeout.
    
    Ensures requests are processed in arrival order while limiting
    concurrent executions.
    """
    def __init__(self, max_concurrent: int, timeout: float = 60.0):
        self._max_concurrent = max_concurrent
        self._timeout = timeout
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._active_count = 0
        self._next_ticket = 0
        self._serving_ticket = 0

    def acquire(self, timeout: float = None) -> int:
        """Acquire a slot in FIFO order. Returns ticket number."""
        timeout = timeout or self._timeout
        with self._condition:
            my_ticket = self._next_ticket
            self._next_ticket += 1
            # Wait until it's our turn AND there's capacity
            while self._serving_ticket != my_ticket or self._active_count >= self._max_concurrent:
                remaining = timeout - (time.monotonic() - start)
                if remaining <= 0:
                    if self._serving_ticket == my_ticket:
                        self._serving_ticket += 1
```

**Patterns:**
- Thread-safe ticket-based concurrency
- Condition variables for synchronization
- Clear docstrings with purpose

#### **Base Service Pattern**
[File: code-index-mcp/src/code_index_mcp/services/base_service.py](code-index-mcp/src/code_index_mcp/services/base_service.py#L1)
```python
class BaseService(ABC):
    """Base class for all MCP services.
    
    This class provides common functionality:
    - Context management through ContextHelper
    - Common validation patterns
    - Shared error checking methods
    """
    
    def __init__(self, ctx: Context):
        self.ctx = ctx
        self.helper = ContextHelper(ctx)

    def _validate_project_setup(self) -> Optional[str]:
        """Validate that the project is properly set up."""
        return self.helper.get_base_path_error()

    def _require_project_setup(self) -> None:
        """Ensure project is set up, raising an exception if not."""
        error = self._validate_project_setup()
        if error:
            raise ValueError(error)
```

**Patterns:**
- Abstract base class (ABC) for inheritance
- Validation methods with error messages
- Context injection pattern
- Helper delegation

#### **Type Hints and Dataclasses**
```python
from dataclasses import dataclass
from typing import Optional, List, Dict, Any
from abc import ABC

@dataclass
class ProjectSettings:
    """Project configuration with validation."""
    base_path: Optional[str] = None
    max_concurrent: int = 3
```

**Pattern:** Full type annotations on all functions

---

### **C. Module Organization**

#### **TypeScript Module Structure**
```
lib/swarm/
├── engine.ts        # Core orchestration logic
├── parse.ts         # Deterministic parsing utilities
├── store.ts         # State management (EventEmitter)
├── types.ts         # Type definitions and interfaces
└── verifier.ts      # Safety verification (secret scanning, etc.)
```

#### **Python Service Layer Structure**
```
code-index-mcp/src/code_index_mcp/
├── server.py                          # MCP server + concurrency
├── project_settings.py                # Config dataClass
├── request_context.py                 # Request scoping
├── constants.py                       # Static values
├── services/                          # Domain services
│   ├── base_service.py               # Abstract base
│   ├── file_service.py               # File operations
│   ├── search_service.py             # Search implementation
│   ├── file_discovery_service.py     # File finding
│   ├── code_intelligence_service.py  # AST analysis
│   ├── index_management_service.py   # Indexing
│   ├── project_management_service.py # Project config
│   ├── file_watcher_service.py       # Auto-refresh
│   └── system_management_service.py  # System utilities
├── indexing/                          # Index building strategies
├── search/                            # Search implementations
└── utils/                             # Helpers and validation
```

---

### **D. Error Handling Patterns**

#### **TypeScript Pattern: Try-Catch with Defaults**
[File: lib/swarm/engine.ts](lib/swarm/engine.ts#L259)
```typescript
async function getGoogleAccessTokenFromAdc(workspace: string): Promise<string | null> {
  try {
    const result = await runProcess("gcloud", ["auth", "application-default", "print-access-token"], {
      cwd: workspace,
      timeout: 5000,
    });
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  } catch {
    // Silently fail - return null for graceful degradation
  }
  return null;
}
```

**Pattern:** Try-catch with null return (not throw) for optional features

#### **TypeScript Pattern: Error Messages with Context**
```typescript
throw new Error(`Codex exited ${result.exitCode}: ${result.stderr.slice(-400)}`);
throw new Error(`Gemini request failed with ${response.status}`);
throw new Error("Run no longer active.");
```

**Pattern:** Include exit codes and last N chars of stderr for debugging

#### **Python Pattern: Validation Errors**
```python
def _require_project_setup(self) -> None:
    error = self._validate_project_setup()
    if error:
        raise ValueError(error)
```

**Pattern:** Raise with descriptive message from validation check

---

### **E. Logging Patterns**

#### **Used via logging standard library** (in Python)
```python
import logging
# Managed by base services via context helpers
```

#### **Event Stream Logging** (TypeScript)
[File: lib/swarm/engine.ts and runs/round-1/messages.jsonl](runs/round-1/messages.jsonl#L1)
```json
{"timestampUtc":"2026-02-16T04:23:29.251Z","round":1,"from":"system","to":"research","type":"task","summary":"Collect local architectural and implementation context."}
{"timestampUtc":"2026-02-16T04:23:29.254Z","round":1,"from":"research","to":"broadcast","type":"feedback","summary":"...","artifactPath":"runs/round-1/research.md","sha256":"..."}
```

**Pattern:** Structured JSON logging with:
- `type`: task|result|feedback|error|control
- `from`/`to`: Agent messaging semantics
- `sha256`: Integrity hashes
- `artifactPath`: Reference to output files

---

## 5. Key Integrations and External Services

### **A. External API Integrations**

#### **Gemini API** (for Research Agent)
```typescript
// lib/swarm/engine.ts
async function runGeminiResearch(...): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1/models/${model}/generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [...] })
  });
  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}`);
  }
}
```

**Configuration via Environment:**
```bash
SWARM_RESEARCH_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3-pro
GOOGLE_USE_ADC=1  # Uses gcloud auth application-default
```

#### **Codex CLI**
```typescript
// lib/swarm/engine.ts
async function runCodexTask(task: AgentTask): Promise<void> {
  const codexBin = process.env.SWARM_CODEX_BIN || "codex";
  const result = await runProcess(codexBin, args, {
    cwd: workspace,
    timeout: 120000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Codex exited ${result.exitCode}`);
  }
}
```

**Configuration via Environment:**
```bash
SWARM_CODEX_BIN=codex  # Path to Codex CLI executable
```

#### **Vercel Deployment**
```bash
npx vercel              # One-click preview deploy
npm run swarm:deploy    # Wrapper command
```

**Runtime Mode on Vercel:**
- Defaults to `demo` mode (safe simulation)
- Full subprocess execution reserved for local environments

#### **Google Cloud ADC** (Application Default Credentials)
```typescript
async function getGoogleAccessTokenFromAdc(workspace: string): Promise<string | null> {
  try {
    const result = await runProcess("gcloud", ["auth", "application-default", "print-access-token"]);
    if (result.exitCode === 0) {
      return result.stdout.trim();
    }
  } catch {
    return null;
  }
}
```

---

### **B. Local CLI Dependencies**

#### **Search Tools** (Auto-detected, in precedence order)
- `ugrep` - Preferred (fastest)
- `ripgrep` (rg) - Fast alternative
- `ag` (The Silver Searcher) - Fallback
- `grep` - Last resort

#### **Linting**
```bash
npm run lint  # Configured as: tsc --noEmit
```

#### **Build**
```bash
npm run build  # Next.js production build
```

---

### **C. Model Context Protocol (MCP) Integration**

#### **code-index-mcp Tools Available**
1. **Project Management**: `set_project_path`, `refresh_index`, `build_deep_index`
2. **Search**: `search_code_advanced`, `find_files`, `get_file_summary`
3. **Monitoring**: `get_file_watcher_status`, `configure_file_watcher`
4. **System**: `create_temp_directory`, `check_temp_directory`, `clear_settings`

#### **Configuration**
```json
{
  "mcpServers": {
    "code-index": {
      "command": "uvx",
      "args": ["code-index-mcp", "--project-path", "/absolute/path/to/repo"]
    }
  }
}
```

---

## 6. File Organization Conventions

### **A. Root-Level Directory Structure**

| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router pages and API routes |
| `code-index-mcp/` | MCP server for code indexing |
| `demo/` | Demo/simulation files |
| `lib/swarm/` | Core swarm orchestration logic |
| `multi-codex/` | Secondary Vite dashboard (SolidJS) |
| `my-app/` | Template/test Vite app |
| `output/` | Test output and reports (Playwright) |
| `prompts/` | Agent prompt templates |
| `runs/` | Execution logs and checkpoint data |
| `scripts/` | CLI utilities and entry points |
| `skills/` | Agent customization skills |
| `swiss-knife-temp/` | Local MCP bridge server |

### **B. Next.js App Structure** (`app/`)
```
app/
├── layout.tsx           # Root layout (React 19)
├── page.tsx            # Home page
├── globals.css         # Global styling
└── api/swarm/          # API routes
    ├── stream/         # SSE streaming endpoint
    ├── state/          # State snapshot endpoint
    ├── start/          # Start run endpoint
    └── control/        # Pause/resume/rewind endpoint
```

### **C. Swarm Engine Structure** (`lib/swarm/`)
```
lib/swarm/
├── types.ts            # Type definitions (AgentId, AgentState, etc.)
├── engine.ts           # Main orchestration logic (~1000+ lines)
├── store.ts            # EventEmitter-based state management
├── parse.ts            # Verification parsing utilities
├── verifier.ts         # Safety checks (secret scanning, etc.)
└── _[test_files]       # Tests colocated with source
```

### **D. Execution Artifacts** (`runs/`)
```
runs/
├── round-1/
│   ├── messages.jsonl              # Structured inter-agent messages
│   ├── research.md                 # Research agent output
│   ├── worker1.md                  # Worker-1 implementation
│   ├── worker2.md                  # Worker-2 (auditor) output
│   ├── evaluator.md                # Quality evaluation
│   └── coordinator.md              # Final decision
├── round-2/
│   └── [same pattern]
└── checkpoints/
    ├── round-1/
    │   ├── app/
    │   ├── lib/
    │   ├── prompts/
    │   └── [full project snapshot]
    └── round-2/
        └── [same pattern]
```

### **E. Configuration Files**

| File | Purpose |
|------|---------|
| `package.json` | Node.js dependencies and scripts |
| `tsconfig.json` | TypeScript compiler options |
| `.env.local` | Local environment (Gemini key, Codex path) |
| `compose.yaml` | Docker Compose production config |
| `compose.debug.yaml` | Docker Compose debug config |
| `Dockerfile` | Container build definition |
| `next.config.ts` | Next.js configuration |

### **F. Python Project Structure** (code-index-mcp)

```
code-index-mcp/
├── pyproject.toml              # setuptools config
├── requirements.txt            # pip freeze output
├── src/code_index_mcp/
│   ├── server.py              # MCP server + FastMCP decorators
│   ├── __main__.py            # Entry point
│   ├── constants.py           # Static values
│   ├── services/              # Domain services (8+ services)
│   ├── indexing/              # AST indexing strategies
│   ├── search/                # Search implementations
│   └── utils/                 # Helpers and validation
├── tests/                     # Unit tests
│   ├── indexing/
│   ├── search/
│   ├── services/
│   └── utils/
└── test/
    └── sample-projects/       # Test fixtures
```

---

## 7. Notable Conventions and Best Practices Observed

### **A. Deterministic Verification**
- All agent outputs parsed with regex patterns (not LLM fallback)
- Status codes (PASS/REVISE/FAIL) extracted deterministically
- SHA-256 hashes for message integrity
- Markdown structure validation before parsing

### **B. Separation of Concerns**
- **Orchestration** separate from **parsing** from **verification**
- **Services layer** decoupled from **MCP decorators**
- Client state management isolated in `store.ts`

### **C. Feature Flagging**
```typescript
export interface SwarmFeatures {
  lintLoop: boolean;
  ensembleVoting: boolean;
  researchAgent: boolean;
  contextCompression: boolean;
  heuristicSelector: boolean;
  checkpointing: boolean;
  humanInLoop: boolean;
}
```
- Runtime switches for each agent capability
- Passed through all execution paths

### **D. Strict Type Safety**
- `strict: true` in tsconfig.json
- Discriminated unions for agent types
- No `any` type usage observed
- Interface-based contracts for APIs

### **E. Graceful Degradation**
- Optional Gemini integration (returns null on failure)
- Demo mode fallback when Codex unavailable
- Continued execution on parse failures (with logging)

### **F. Observable Execution**
- Real-time SSE streaming
- Structured JSON logging
- Event timeline in UI
- Checkpoint snapshots for replay

---

## 8. Summary: Concrete Examples by Access Pattern

### **To debug why an agent failed:**
1. Check `runs/round-N/messages.jsonl` for message types and summaries
2. Read `runs/round-N/agent-name.md` for full output
3. Check `lib/swarm/parse.ts` for parsing logic
4. Check `lib/swarm/verifier.ts` for safety checks

### **To add a new agent:**
1. Add `AgentId` union type to `lib/swarm/types.ts`
2. Add parsing logic to `lib/swarm/parse.ts`
3. Add execution logic to `lib/swarm/engine.ts` (async generator pattern)
4. Update `AGENTS_ARCHITECTURE.md` topology section

### **To deploy to production:**
```bash
npm run swarm:deploy -- --prod  # Vercel one-click
# or
docker build -t codexorch . && docker-compose up -d
```

### **To run tests:**
```bash
# Node/TypeScript
npm test  # E2E via Playwright

# Python (code-index-mcp)
cd code-index-mcp && pytest -q
```

### **To add code indexing to a project:**
```bash
# Via uvx (recommended)
{
  "mcpServers": {
    "code-index": {
      "command": "uvx",
      "args": ["code-index-mcp", "--project-path", "/path/to/repo"]
    }
  }
}
```
