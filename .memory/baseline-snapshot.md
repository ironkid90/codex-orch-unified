# Baseline Snapshot: Hierarchical Agent Memory (HAM)

Established March 17, 2026 — Token efficiency and scope boundaries for Hierarchical Agent Memory system.

---

## Scoping: Bounded Contexts

The HAM system organizes knowledge around six natural subsystems:

### Primary Subsystems

1. **lib/swarm** (orchestrator)
   - Core execution engine, runtime state, control flow
   - Key classes: Engine, ControlCenter, RuntimeState
   - ~3,500 lines of TypeScript

2. **lib/providers** (routing & model fallbacks)
   - Provider factory, model routing, credential management
   - Key modules: factory.ts, model-routing.ts, setup.ts
   - ~1,200 lines of TypeScript

3. **lib/tools** (registry & sandboxing)
   - Tool registry, safe eval, workspace isolation
   - Key modules: registry.ts, safe-eval.ts, workspace-manager.ts
   - ~950 lines of TypeScript

4. **config/** (settings & schema)
   - Configuration schema, defaults, env-var resolution
   - Key files: providers.schema.ts, model-routing.json
   - ~400 lines (schema + JSON)

5. **app/** (dashboard & UI)
   - React app for swarm visualization, control panel
   - ~2,000 lines of TypeScript + JSX

6. **foundry_agents/** (Python sidecar)
   - Optional Python services for data processing
   - ~800 lines of Python

**Total**: ~8,850 lines of code across 6 subsystems

---

## Token Efficiency Metrics (Baseline: March 2026)

### Context Windows

| Scenario | Estimated Tokens | Source |
|----------|------------------|--------|
| Full project context (all files) | 50,000–60,000 | All .ts, .json, README, types |
| Root CLAUDE.md | ~300 | Project overview + links |
| Single scoped CLAUDE.md | ~350 | One subsystem overview |
| decisions.md (10 decisions) | ~2,200 | Architectural log |
| patterns.md (8 patterns) | ~1,800 | Reusable conventions |
| inbox.md (template only) | ~400 | Subagent queue + format |
| audit-log.md (baseline) | ~450 | Change tracking |
| baseline-snapshot.md (this) | ~500 | Token metrics + strategy |
| **ROOT + SCOPED (6 files total)** | **~2,400** | Root + one subsystem |
| **ROOT + SCOPED + decisions** | **~4,600** | Root + subsystem + decisions |

### Token Reduction

| Task Type | Full Context | Root + Scoped Only | With Decisions | Reduction |
|-----------|--------------|-------------------|----------------|-----------|
| Single-subsystem bug fix | 55,000 | 2,400 | 4,600 | **96%** |
| Cross-subsystem feature (2 subsystems) | 55,000 | 3,000 | 5,200 | **91%** |
| Architectural review (full) | 60,000 | 2,400 | 4,600 | **92%** |
| New agent onboarding | 55,000 | 2,400 | 4,600 | **92%** |

### Expected Savings (Per Session)

| Scenario | Baseline Tokens | HAM Tokens | Savings | Efficiency Gain |
|----------|-----------------|-----------|---------|-----------------|
| Single subsystem (5 tasks) | 275,000 | 23,000 | 252,000 | **91%** |
| Multi-subsystem project (10 tasks) | 550,000 | 92,000 | 458,000 | **83%** |
| Subagent inference (100 tasks) | 5,500,000 | 920,000 | 4,580,000 | **83%** |

---

## Memory Scopes & Refresh Strategy

### Scope 1: Root CLAUDE.md
- **Purpose**: Project overview, high-level architecture, navigation
- **Content**: Problem statement, subsystem links, glossary
- **Refresh**: Weekly or after major decision + decision.md updated
- **Audience**: All agents; loaded first in every session

### Scope 2–7: Scoped CLAUDE.md (per subsystem)
- **Purpose**: Subsystem-specific overview, APIs, key patterns
- **Content**: Subsystem responsibilities, main files, entry points, gotchas
- **Refresh**: Bi-weekly or when subsystem has active development
- **Audience**: Agents working on that subsystem
- **Location**: lib/swarm/CLAUDE.md, lib/providers/CLAUDE.md, lib/tools/CLAUDE.md, etc.

### Scope 8: decisions.md
- **Purpose**: "Why" behind major architecture choices
- **Content**: Decision context, options, rationale, outcomes, related files
- **Refresh**: After each major decision (append, never delete)
- **Audience**: Architects, code reviewers, future agents
- **Retention**: Permanent (archive old decisions if >50 entries)

### Scope 9: patterns.md
- **Purpose**: Reusable conventions and design patterns
- **Content**: Context, example, benefits, gotchas, files using pattern
- **Refresh**: Monthly or when new pattern emerges
- **Audience**: All agents (reference during implementation)
- **Retention**: Permanent; update if pattern evolves

### Scope 10: inbox.md
- **Purpose**: Async knowledge capture by subagents
- **Content**: New findings queued for review (NEW → REVIEWED → MERGED)
- **Refresh**: Continuous (subagents append on discovery)
- **Audience**: Memory Steward (reviewer role)
- **Retention**: Entries removed after MERGED; archive old entries if >20 pending

### Scope 11: audit-log.md
- **Purpose**: Change transparency and recovery trail
- **Content**: Timestamp, agent, action, files changed, reason
- **Refresh**: Continuous (log every material change)
- **Audience**: All agents (for context)
- **Retention**: Permanent (append only; never delete)

### Scope 12: baseline-snapshot.md
- **Purpose**: Token metrics and refresh boundaries
- **Content**: Subsystem scopes, token counts, savings calculations, refresh schedule
- **Refresh**: Quarterly or when major restructuring happens
- **Audience**: Memory Steward (operationalization)
- **Retention**: Permanent (one per quarter; archive old snapshots)

---

## Next Steps & Implementation Roadmap

### Phase 1: Foundation (Done — March 17, 2026)
- [x] Create 5 core memory files (decisions.md, patterns.md, inbox.md, audit-log.md, baseline-snapshot.md)
- [x] Establish file formats and templates
- [x] Document token reduction models

### Phase 2: Scoped Documentation (Planned)
- [ ] Create Root CLAUDE.md (project overview)
- [ ] Create Scoped CLAUDE.md for each subsystem (lib/swarm/, lib/providers/, lib/tools/, config/, app/, foundry_agents/)
- [ ] Link to memory scopes from each CLAUDE.md

### Phase 3: Agent Integration (Planned)
- [ ] Wire .memory/ into Copilot workspace settings (global context)
- [ ] Wire .memory/ into Codex CLI (--context flag)
- [ ] Wire .memory/ into Roo agent (via config)
- [ ] Wire .memory/ into VS Code extension (context provider)

### Phase 4: Subagent Automation (Planned)
- [ ] Implement subagent inbox.md update workflow
- [ ] Create automated review checklist for Memory Steward
- [ ] Set up cron job: refresh root CLAUDE.md weekly
- [ ] Set up cron job: consolidate audit-log.md quarterly

### Phase 5: Optimization (Planned)
- [ ] Monitor token savings vs. baseline (monthly)
- [ ] Adjust subsystem scopes if needed (e.g., split oversized subsystem)
- [ ] Archive old decisions/patterns if >50 entries
- [ ] Refine refresh schedule based on actual activity

---

## Operational Notes

### Memory Steward Role

Designate one person/team as **Memory Steward** responsible for:
- Weekly review of inbox.md (check NEW entries)
- Merge approved entries to decisions.md or patterns.md
- Monthly refresh of patterns.md (discover new patterns)
- Quarterly baseline-snapshot.md update (token tracking)
- Periodic CLAUDE.md refresh (navigation + context)

### Refresh Automation Ideas

```bash
# Weekly: Refresh root CLAUDE.md (if any changes to decisions.md)
0 9 * * 1 generate-root-claude.sh

# Bi-weekly: Refresh scoped CLAUDE.md for lib/swarm (if active)
0 9 * * 2,4 generate-scoped-claude.sh lib/swarm

# Monthly: Update patterns.md summary
0 10 1 * * update-patterns-index.sh

# Quarterly: Baseline snapshot (token review)
0 10 1 * 0,3,6,9 update-baseline-snapshot.sh
```

### Tools & Integration

- **GitHub Actions**: Automate inbox.md review reminders
- **VS Code Extension**: Highlight memory files in .memory/ folder
- **Copilot Integration**: Auto-include root CLAUDE.md + relevant scoped files per task
- **Codex CLI**: Accept `--memory-scope swarm` to load only swarm subsystem context

---

## FAQ

**Q: How do I know which CLAUDE.md files to load for a task?**
A: Root CLAUDE.md always (2,400 tokens). Add scoped CLAUDE.md for subsystems you're working on. For multi-subsystem work, load 2–3 scoped files; if approaching token limit, fall back to decisions.md + patterns.md instead.

**Q: What if my change doesn't fit into existing decisions or patterns?**
A: Create a NEW entry in inbox.md. Memory Steward will review and decide whether it merits a new decision/pattern or is task-specific context.

**Q: How do I update a decision that turned out wrong?**
A: Don't delete; add an "Outcome: [revised based on ...]" note. If needs major revision, create a NEW decision with "Revised: [link to original]" in intro.

**Q: Can I archive old entries?**
A: Yes, if decisions.md or patterns.md exceed 50–60 entries each. Create archive/decisions-archived-2025.md and move entries >2 years old. Update audit-log.md to note archival.

