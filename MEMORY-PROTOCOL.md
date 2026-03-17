# Universal Memory Protocol

This is the only canonical protocol document for cross-assistant memory behavior in `codex-orch-unified`.

**Hierarchical Agent Memory (HAM)** is the universal centralized context repository for this repo. The canonical compressed knowledge sources are:

- root `CLAUDE.md`
- relevant scoped `*/CLAUDE.md`
- `.memory/decisions.md`
- `.memory/patterns.md`
- `.memory/inbox.md`
- `.memory/baseline-snapshot.md`

Use HAM to route, read, and write durable repo context. Do not create parallel memory stores or duplicate long-form repo summaries when an existing HAM entrypoint can be updated instead.

## Mandatory execution order

All assistants must follow this order before planning or editing:

1. Read root `CLAUDE.md`.
2. Read the relevant scoped `CLAUDE.md` for the subsystem or path being touched.
3. If the task touches architecture, workflow design, or reusable implementation patterns, consult `.memory/decisions.md` and/or `.memory/patterns.md`.
4. Only then plan and execute.

If multiple subsystems are involved, read each relevant scoped `CLAUDE.md` before acting.

## Mandatory post-task write-back

After every task, append one compressed summary to `.memory/inbox.md`.

Rules:

- One entry per task.
- Keep it factual and compact.
- Use repo-relative paths.
- If work is blocked or partial, still append an entry and record the blocker under `Follow-ups`.
- Durable architectural "why" should later be merged into `.memory/decisions.md`.
- Durable reusable implementation "how" should later be merged into `.memory/patterns.md`.

## Standard summary schema

Use this exact field set. Prefer ISO 8601 UTC; a date-only value is acceptable when exact time is unavailable.

```markdown
## 2026-03-17T00:00:00Z — Copilot — Short task label

**Timestamp**: 2026-03-17T00:00:00Z
**Agent**: Copilot
**Task**: One-line description of the task.
**Touched Paths**:
- `path/to/file`
**Actions Taken**:
- Action or verification performed.
**State Changes**:
- What now exists or changed; use `None` for read-only work.
**Insights/Decisions**:
- Durable takeaway or `None`.
**Follow-ups**:
- Required next step or `None`.
**Status**: [x] NEW | [ ] REVIEWED | [ ] MERGED
**Merged To**: `decisions.md#...` or `patterns.md#...` (only when MERGED)
```

## Assistant notes

- **Copilot**: Load HAM files with workspace reads before suggesting or applying edits. Append the inbox summary before handing the task back.
- **Roo**: Use root/scoped `CLAUDE.md` files as required repo context. Route lasting findings through `.memory/inbox.md`, not ad-hoc chat notes.
- **Codex**: Treat HAM as the required repo pre-read set. Persist durable task context back to `.memory/inbox.md` because session state is not repository memory.
- **Gemini CLI**: Read HAM files explicitly at task start and append a markdown summary to `.memory/inbox.md` at task end.
- **Generic agents**: Map any built-in memory or preloaded context feature to this same read order and keep HAM as the source of truth.
