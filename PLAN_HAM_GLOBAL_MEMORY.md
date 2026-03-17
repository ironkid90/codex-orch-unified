# Plan: Global Hierarchical Agent Memory (HAM) Implementation

## Objective

Implement a unified, global memory layer for Swarm project that is accessible by VS Code Copilot, Codex, Roo, and other agents. Use subagent-driven development with two-stage review (spec compliance, then code quality) for each task.

## Context

- **Scope**: Root-level CLAUDE.md, per-subdirectory CLAUDE.md files, .memory/ layer with structured records
- **Integration**: VS Code memory-usage.instructions.md protocol, Codex/Roo config points
- **Efficiency**: Token savings via context routing, dashboard awareness, subagent-driven summarization

## Tasks (In Order)


### Task 1: Draft Root CLAUDE.md Routing Context
**Description**: Create root `CLAUDE.md` with hierarchical context routing for all major bounded contexts (lib/swarm, lib/providers, lib/tools, config, prompts, batch, foundry_agents).

**Deliverables**:

- `./CLAUDE.md` at project root with:
  - Project summary (2-3 lines)
  - Bounded context index (links to subdir CLAUDE.md files)
  - Recent decisions/gotchas (5-10 items)
  - Token-saving routing strategy

**Acceptance Criteria**:

- Spec: Covers all major subdirs, includes recent decisions, routes to subscoped CLAUDE.md
- Quality: Clear hierarchy, proper links, no duplication

---

### Task 2: Create Scoped CLAUDE.md Files

**Description**: Generate CLAUDE.md for each major bounded context.

**Scopes** (organized by priority):

1. `lib/swarm/CLAUDE.md` — Core orchestrator (engine, types, store, control-center, mcp-client)
2. `lib/providers/CLAUDE.md` — Provider/model routing (setup, fallback logic)
3. `lib/tools/CLAUDE.md` — Tool execution (capabilities, registry)
4. `config/CLAUDE.md` — Configuration sources (.env, mcp-settings.json, routing)
5. `app/CLAUDE.md` — Dashboard API/UI integration points
6. `foundry_agents/CLAUDE.md` — Foundry sidecar (if active)

**Deliverables** (per scope):

- `<scope>/CLAUDE.md` with:
  - 1-2 line scope summary
  - Key files (3-5 main files)
  - Architecture/design notes (1-2 paragraphs)
  - Known issues / gotchas (if any)
  - Recent PRs/changes (if any)

**Acceptance Criteria**:

- Spec: Each scope is covered, links point to actual files, notes are factual
- Quality: Concise, no duplication with root, proper emphasis on key patterns

---

### Task 3: Create .memory/ Layer
**Description**: Establish structured memory files in `.memory/` directory for persistent knowledge sharing.

**Deliverables**:

- `.memory/decisions.md` — Major architectural decisions (5-15 items with pros/cons)
- `.memory/patterns.md` — Reusable patterns and conventions (3-10 patterns)
- `.memory/inbox.md` — Incoming summary feeds (for subagent-driven updates)
- `.memory/audit-log.md` — Changes to memory by date/agent/reason
- `.memory/baseline-snapshot.md` — Token count, scope boundaries, refresh schedule

**Acceptance Criteria**:

- Spec: All files exist, inbox/audit-log are ready for subagent writes, baseline set
- Quality: Markdown well-formed, decisions have clear rationale, patterns are actionable

---

### Task 4: Wire Global HAM into Cross-Tool Config

**Description**: Integrate global memory paths into Codex, Roo, Copilot, and VS Code configuration.

**Deliverables**:

- `.codexrc` (or update existing) — Point to global CLAUDE.md and .memory/ for context
- `roo.config.json` (or similar) — Configure Roo to use project's CLAUDE.md as baseline
- `.vscode/settings.json` — Register memory directory for VS Code Copilot memory-usage protocol
- `mcp.json` (user config) — Add memory polling/refresh as MCP service point (optional)
- Document in `README.md` — Memory setup and refresh workflow

**Acceptance Criteria**:

- Spec: Each tool's config points to correct paths, memory paths exist, VS Code protocol followed
- Quality: No breaking changes, configs are validated against schema, paths are absolute or properly rooted

---

### Task 5: Implement Subagent-Driven Summarization System

**Description**: Create lightweight framework for subagents to summarize work and update global memory (decisions, patterns, inbox).

**Deliverables**:

- `lib/memory/summarizer.ts` — Subagent coordination API (queue, dispatch, merge)
- `scripts/memory-refresh.ts` — Manual/CLI trigger to refresh .memory/ from subagents
- Update `app/api/swarm/control-center/route.ts` — Add memory refresh endpoint
- Dashboard widget — Show memory status, last refresh, pending summaries (in control-center)
- Document in `README.md` — Subagent-driven memory workflow

**Acceptance Criteria**:

- Spec: Subagents can queue summaries, memory refreshes without conflicts, dashboard shows status
- Quality: No race conditions, proper error handling, logs audit trail, tests cover happy path

---

## Execution Strategy (Subagent-Driven Development)


**Per Task**:

1. Dispatch **implementer subagent** with full task context
2. Implementer asks clarifying questions (answer before they proceed)
3. Implementer implements, self-reviews, commits
4. Dispatch **spec compliance reviewer** — does code match task spec?
   - If no: implementer fixes, reviewer reviews again
5. Dispatch **code quality reviewer** — is implementation well-built?
   - If no: implementer fixes, reviewer reviews again
6. Mark task complete

**After all tasks**:

- Dispatch **final code reviewer** for entire implementation
- Use `superpowers:finishing-a-development-branch` to clean up

## Linked Resources

- [Hierarchical Agent Memory (HAM) SKILL](../../../.agents/skills/hierarchical-agent-memory/SKILL.md)
- [Subagent-Driven Development SKILL](../../../.agents/skills/subagent-driven-development/SKILL.md)
- [VS Code Memory Protocol](~/.vscode-insiders/extensions/agent-memory/prompts/memory-usage.instructions.md)

---

## Success Criteria (Overall)

- [ ] Root CLAUDE.md + scoped CLAUDE.md files exist and route correctly
- [ ] .memory/ layer has all files, well-structured, ready for subagent updates
- [ ] Codex, Roo, Copilot, VS Code all read from global memory (verified via config)
- [ ] Subagent-driven summarization queues and syncs without conflicts
- [ ] Dashboard shows memory status and allows manual refresh
- [ ] No token budget increases; in fact, provides token savings via context routing
