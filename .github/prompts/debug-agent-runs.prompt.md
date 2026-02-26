---
description: "Analyze and debug the latest agent orchestration run"
agent: "agent"
argument-hint: "Specify run ID (e.g., 'round-1') or leave blank for latest"
---

# Debug Agent Orchestration Run

Analyze agent orchestration runs to identify issues, performance bottlenecks, and execution patterns. Supports single-run debugging and cross-run historical analysis.

## Analysis Steps

1. **Load Execution Metadata**
   - Find run(s) in `runs/` (specify run ID or analyze latest + historical)
   - Read `messages.jsonl` (JSONL format with inter-agent routing semantics)
   - Extract run summaries, checkpoints, and round metrics

2. **Identify Issues**
   - Check for failed agent transitions or missing responses
   - Detect timeout/error sequences in message logs
   - Verify SHA-256 message integrity (if present)
   - Look for agent routing anomalies (incorrect fan-in/fan-out)
   - Track recurring failures across runs (patterns)

3. **Extract Performance Metrics**
   - Count messages per agent (worker1, worker2, coordinator, evaluator, researcher)
   - Identify longest-running steps and bottlenecks
   - Track success/failure rates over time
   - Compare metrics across runs (if analyzing multiple)

4. **Provide Actionable Insights**
   - Explain root cause of failures (e.g., API errors, parsing failures, timeout)
   - Suggest which agent/service to investigate first
   - Recommend fixes based on actual code patterns in the workspace
   - Identify trends (e.g., "worker2 fails when messages exceed 100")

## Output Format

### Human-Readable Analysis

**Issue Summary:**
- Primary failure point(s)
- Affected agent(s)
- Likely cause(s)
- Recurrence patterns (if comparing multiple runs)

**Metrics:**
- Total messages processed
- Per-agent message counts
- Slowest step(s)
- Success/failure rate timeline

**Recommended Actions:**
- Which file(s) to review
- Specific code sections or services to debug
- Example reproduction steps
- Priority (critical, warning, informational)

### Structured Output (JSON)

```json
{
  "analysis": {
    "run_id": "round-1",
    "runs_analyzed": ["round-1", "round-2"],  // if historical
    "timestamp": "2026-02-17T...",
    "issues": [
      {
        "severity": "critical",
        "agent": "worker2",
        "type": "timeout",
        "count": 3,
        "first_occurrence": "round-1",
        "last_occurrence": "round-2",
        "recommendation": "..."
      }
    ],
    "metrics": {
      "total_messages": 847,
      "per_agent": { "coordinator": 120, "worker1": 200, ... },
      "slowest_step": "researcher_call (12.5s)"
    }
  }
}
```

## References

- Message log location: [`runs/<round-id>/messages.jsonl`]
- Checkpoint format: [`runs/checkpoints/`]
- Agent definitions: [`prompts/coordinator.md`], [`prompts/worker1.md`], etc.
- Orchestration engine: [`lib/swarm/engine.ts`]
