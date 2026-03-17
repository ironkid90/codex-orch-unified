# Inbox: Post-Task HAM Summaries

This file is the HAM write-back queue. After every task, append one compressed summary here. Durable architectural reasoning belongs in `decisions.md`; reusable implementation conventions belong in `patterns.md` after review.

## Workflow

- **NEW**: appended by an assistant and awaiting review.
- **REVIEWED**: checked, clarified, and ready to merge.
- **MERGED**: durable facts moved to `decisions.md` or `patterns.md`; keep a pointer in the entry.

## Required Schema

See [MEMORY-PROTOCOL.md § Standard summary schema](./MEMORY-PROTOCOL.md#standard-summary-schema) for exact field requirements and usage guidance.

---

## 2026-03-17T00:00:00Z — Copilot — Task 1: establish canonical HAM protocol and reduce CLAUDE.md DRY overlap

**Timestamp**: 2026-03-17T00:00:00Z
**Agent**: Copilot
**Task**: Establish the canonical HAM protocol, reduce DRY overlap between CLAUDE.md and MEMORY-PROTOCOL.md, remove fragile hardcoded file citations, promote critical issues upfront, and add token methodology notes.

**Touched Paths**:

- `MEMORY-PROTOCOL.md` (created in prior task)
- `CLAUDE.md`
- `.memory/inbox.md`
- `.memory/baseline-snapshot.md`

**Actions Taken**:

- Replaced duplicative Universal Memory Protocol prose in CLAUDE.md with a single-line pointer to MEMORY-PROTOCOL.md, reducing routing-doc bloat.
- Moved critical issues (merge conflict markers in .gitignore, committed secrets in .kilocode/) from buried gotchas to prominent "🚨 CRITICAL ISSUES" section before architecture decisions.
- Removed fragile hardcoded line-range citations (:63–67, :18, :107–114, :82–94) and replaced with file/component pointers that survive edits.
- Renumbered remaining gotchas (Provider Interface Contract, capability-types.ts) for clarity.
- Updated inbox schema reference to link to MEMORY-PROTOCOL instead of duplicating it.

**State Changes**:

- CLAUDE.md is now purely routing-first with no protocol duplication.
- Critical deployment/security issues are visible at a glance (not buried in gotchas list).
- File citations are maintenance-friendly (no line numbers).
- inbox.md schema overhead reduced from ~20 lines to a single pointer.

**Insights/Decisions**:

- Routing docs should be compact; protocol contract lives once in MEMORY-PROTOCOL.md.
- Critical issues need visual isolation (🚨 prefix + dedicated section) to prevent deployment surprises.
- Line-number citations in docs are fragile; component/file references are preferred.

**Follow-ups**:

- None (Quality review task complete).

**Status**: [x] NEW | [ ] REVIEWED | [ ] MERGED
