# Azure Worker Agent Templates

These templates are meant to be easy to upload into Azure AI Foundry / Azure agent configuration as a reusable base worker.

## Files

- `gpt-5.4-mini-coding-worker.agent.yaml`
- `gpt-5.4-mini-coding-worker.agent.json`

Use whichever import path Azure accepts more reliably in your current UI.

## Why this template

This worker is tuned for:

- scoped coding work
- low hallucination pressure
- strong handoff quality
- reuse across many swarm roles
- GPT-5.4 mini as the default bulk worker

## Recommended runtime specialization

Keep one strong base worker and inject a role overlay at runtime instead of creating many nearly-identical agents.

Example role overlay:

```text
ROLE OVERLAY:
You are currently assigned the role: coding-worker

Role goal:
Implement the scoped engineering task reliably and leave a clean handoff.

Primary responsibilities:
- inspect before changing
- make the smallest effective change
- verify what you can

Constraints:
- do not invent results
- preserve existing conventions
- surface blockers clearly

Definition of done:
- task completed or blocker clearly reported
- verification status included
- next step included
```

## Suggested next agents

After this base worker, the highest-value follow-ups are:

- an evaluator / reviewer agent
- a coordinator agent

Those should stay separate because their behavior differs more meaningfully from the worker than simple role overlays.
