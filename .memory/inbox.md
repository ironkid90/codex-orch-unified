# Inbox: Subagent Summary Updates

Welcome to the Inbox — the queue for subagent-driven memory updates. Each agent (Copilot, Codex, Roo, VS Code) can append discoveries here. Entries flow from NEW → REVIEWED → MERGED to decisions.md or patterns.md.

---

## Example Entry: Initial HAM Setup — 2026-03-17

**Topic**: Hierarchical Agent Memory (HAM) scaffolding for token efficiency

**Key Finding**: Structured memory design reduces per-task context by 40–95% depending on task scope.

**Details**:
- Root CLAUDE.md + scoped files: ~2,400 tokens (vs. 50–60K full project context)
- Decisions.md: Captures "why" behind architecture (prevents rework)
- Patterns.md: Reusable conventions (faster onboarding for new agents)
- inbox.md: Async knowledge capture (agents don't block on review)
- audit-log.md: Change transparency (who changed what, when, why)
- baseline-snapshot.md: Token metrics & refresh strategy (track savings)

**Status**: ✓ MERGED

**Reviewer**: Copilot (initial setup)

**Notes**: This established the HAM foundation. Next: wire into Codex, Roo, VS Code global config.

---

## Template for New Entries

Copy this template and append below when creating a new entry:

```markdown
## [Agent Name] — [YYYY-MM-DD]

**Topic**: [What was investigated? One line.]

**Key Finding**: [Single sentence outcome or insight.]

**Details**: 
- Point 1
- Point 2
- Point 3 (optional)

**Status**: [ ] NEW | [ ] REVIEWED | [x] MERGED

**Reviewer**: [Name or "Pending"]

**Notes**: [Optional context: limitations, follow-ups, related decisions]
```

### Status Field Guide:
- **NEW**: Just added; awaiting review
- **REVIEWED**: Feedback collected; ready for merge
- **MERGED**: Integrated into decisions.md or patterns.md (note which file + heading)

### Reviewer Guidelines:
- Check: Is this finding grounded in actual code/conversation?
- Check: Is this actionable for future agents?
- Check: Does it belong in decisions (architectural "why") or patterns (reusable "how")?
- Sign off: Add reviewer name + date when moving to REVIEWED

---

## How to Merge an Entry

When an entry reaches REVIEWED status, the Memory Steward will:

1. Extract key facts from the entry
2. Create a new decision or pattern (or update existing)
3. Update the entry: `**Status**: [x] MERGED` + add `**Merged To**: decisions.md#decision-name`

Example merge note:
```
**Status**: [x] MERGED
**Merged To**: decisions.md#Decision-Node-25-Compatibility
**Merged By**: Copilot (2026-03-18)
```

---

## Subagent Checklist

Before appending an entry here, make sure:
- [ ] Finding is grounded in code, conversation, or verified repo memory
- [ ] It's actionable for _future_ agents (not just this task)
- [ ] It's independent of current PR/task (survives even if not merged)
- [ ] Topic is clear (search-friendly for future discovery)
- [ ] No secrets, sensitive paths, or credentials included

---

## Refresh Notes

- Check inbox daily (or trigger after major architectural work)
- Merged entries are removed from inbox (they live in decisions.md or patterns.md now)
- If an entry stays NEW for 2+ weeks, reach out to originating agent for clarification

